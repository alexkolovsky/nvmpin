import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { shimDir } from '../registry.js';

const MARKER = '.nvmpin/bin';

export function rcSnippet(home) {
  const defaultHome = path.join(os.homedir(), '.nvmpin');
  const binPath = home === defaultHome ? '$HOME/.nvmpin/bin' : path.join(home, 'bin');
  return `export PATH="${binPath}:$PATH" # nvmpin`;
}

export function rcFileFor(env) {
  const shell = env.SHELL || '';
  const file = shell.endsWith('zsh') ? '.zshrc' : '.bashrc';
  return path.join(os.homedir(), file);
}

export default async function setup(ctx) {
  const { ui } = ctx;
  fs.mkdirSync(shimDir(ctx.home), { recursive: true });
  ui.print(`created ${shimDir(ctx.home)}`);

  const snippet = rcSnippet(ctx.home);
  const rcFile = rcFileFor(ctx.env);

  ui.print('');
  ui.print('Add this line to your shell rc file, AFTER the nvm init lines:');
  ui.print('');
  ui.print('  ' + ui.bold(snippet));
  ui.print('');

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
