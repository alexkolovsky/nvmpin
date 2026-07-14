#!/usr/bin/env node
import { parseArgs } from 'node:util';
import os from 'node:os';
import path from 'node:path';
import { createUi } from './ui.js';
import { UserError, EnvError } from './errors.js';

const COMMANDS = ['setup', 'add', 'remove', 'move', 'list', 'scan', 'exec', 'doctor'];

const HELP = `nvmpin — pin global npm CLIs to specific nvm-managed node versions

Usage:
  nvmpin setup                          Create dirs and print the PATH snippet for your shell rc
  nvmpin add <pkg>[@<ver>] --node <v>   Install (if needed) and pin a package to a node version
  nvmpin remove <pkg> [--uninstall]     Remove pin and shims (--uninstall also removes the package)
  nvmpin move <pkg> --node <v>          Reinstall the package under another node version
  nvmpin list [--json]                  Show pinned packages and their status
  nvmpin scan [--json]                  Report global packages across all nvm node versions
  nvmpin exec <pkg> -- <args...>        Run a pinned package's main bin directly
  nvmpin doctor                         Check shims, registry, and PATH ordering

Global flags:
  --yes         Skip confirmation prompts
  --no-color    Disable colored output (NO_COLOR env var also respected)
  --json        Machine-readable output (list, scan)
  --help, -h    Show this help

Environment:
  NVM_DIR       nvm installation dir (default ~/.nvm)
  NVMPIN_HOME   nvmpin data dir (default ~/.nvmpin)
  NVMPIN_DEBUG  set to 1 to print stack traces on errors
`;

export function buildContext(env = process.env) {
  return {
    env,
    home: env.NVMPIN_HOME || path.join(os.homedir(), '.nvmpin'),
    nvmDir: env.NVM_DIR || path.join(os.homedir(), '.nvm'),
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  if (process.platform === 'win32') {
    process.stderr.write('error: nvmpin does not support Windows in v1 (POSIX only: macOS and Linux).\n');
    return 2;
  }

  // `exec` passes everything after `--` to the child untouched.
  let passthrough = [];
  const sep = argv.indexOf('--');
  if (sep !== -1) {
    passthrough = argv.slice(sep + 1);
    argv = argv.slice(0, sep);
  }

  let parsed;
  try {
    parsed = parseArgs({
      args: argv,
      allowPositionals: true,
      options: {
        node: { type: 'string' },
        uninstall: { type: 'boolean', default: false },
        json: { type: 'boolean', default: false },
        yes: { type: 'boolean', default: false },
        'no-color': { type: 'boolean', default: false },
        help: { type: 'boolean', short: 'h', default: false },
      },
    });
  } catch (err) {
    process.stderr.write(`error: ${err.message}\n`);
    process.stderr.write('hint: run `nvmpin --help` for usage.\n');
    return 1;
  }

  const { values, positionals } = parsed;
  const color = !values['no-color'] && !env.NO_COLOR && Boolean(process.stdout.isTTY);
  const ui = createUi({ color, yes: values.yes });

  if (values.help || positionals.length === 0) {
    ui.print(HELP);
    return values.help || positionals.length === 0 ? 0 : 1;
  }

  const [command, ...args] = positionals;
  if (!COMMANDS.includes(command)) {
    ui.error(`unknown command: ${command}`);
    ui.hint('run `nvmpin --help` for the list of commands.');
    return 1;
  }

  const ctx = { ...buildContext(env), ui, flags: values, passthrough };

  try {
    const mod = await import(`./commands/${command}.js`);
    const code = await mod.default(ctx, args);
    return code ?? 0;
  } catch (err) {
    if (err instanceof UserError || err instanceof EnvError) {
      ui.error(err.message);
      if (err.hint) ui.hint(err.hint);
      if (env.NVMPIN_DEBUG === '1') process.stderr.write(err.stack + '\n');
      return err.exitCode;
    }
    ui.error(`internal error: ${err.message}`);
    ui.hint('re-run with NVMPIN_DEBUG=1 for a stack trace; please report this bug.');
    if (env.NVMPIN_DEBUG === '1') process.stderr.write(err.stack + '\n');
    return 3;
  }
}

// Only run when invoked as a CLI, not when imported by tests.
if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith('/nvmpin')) {
  process.exitCode = await main();
}
