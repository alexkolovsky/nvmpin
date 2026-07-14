import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shimDir } from '../registry.js';

// Marker comment: makes the append idempotent (we grep for it before
// appending) and identifiable regardless of NVMPIN_HOME.
const MARKER = '# nvmpin';

export function rcSnippet(home) {
  const defaultHome = path.join(os.homedir(), '.nvmpin');
  const binPath = home === defaultHome ? '$HOME/.nvmpin/bin' : path.join(home, 'bin');
  return `export PATH="${binPath}:$PATH" ${MARKER}`;
}

// Only shells whose rc file and syntax we know get the append offer.
// Returns null for fish/others — we print the snippet and let the user
// translate it, rather than appending bash syntax to a file their shell
// may never read.
export function rcFileFor(env) {
  const shell = path.basename(env.SHELL || '');
  if (shell === 'zsh') return path.join(os.homedir(), '.zshrc');
  if (shell === 'bash') return path.join(os.homedir(), '.bashrc');
  return null;
}

export default async function setup(ctx) {
  const { ui } = ctx;
  fs.mkdirSync(shimDir(ctx.home), { recursive: true });
  ui.print(`created ${shimDir(ctx.home)}`);

  const snippet = rcSnippet(ctx.home);
  ui.print('');
  ui.print('Add this line to your shell rc file, AFTER the nvm init lines:');
  ui.print('');
  ui.print('  ' + ui.bold(snippet));
  ui.print('');

  const rcFile = rcFileFor(ctx.env);
  if (rcFile === null) {
    ui.print(
      `your shell (${ctx.env.SHELL || 'unknown'}) is not bash or zsh — add the equivalent to your shell's config manually.`
    );
    return 0;
  }

  const existing = fs.existsSync(rcFile) ? fs.readFileSync(rcFile, 'utf8') : '';
  if (existing.includes(MARKER)) {
    ui.print(`${rcFile} already contains an nvmpin PATH entry — nothing to do.`);
    return 0;
  }

  if (await ui.confirm(`Append it to ${rcFile} now?`)) {
    fs.appendFileSync(rcFile, `\n${snippet}\n`);
    ui.print(`appended to ${rcFile}. Restart your shell or run: source ${rcFile}`);
  } else {
    ui.print('not appended — add it manually when ready.');
  }
  return 0;
}
