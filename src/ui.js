import readline from 'node:readline';

const CODES = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
};

export function createUi({ color = true, yes = false, stdout = process.stdout, stderr = process.stderr, stdin = process.stdin } = {}) {
  const paint = (code, s) => (color ? `${CODES[code]}${s}${CODES.reset}` : String(s));

  const ui = {
    color,
    yes,
    bold: (s) => paint('bold', s),
    dim: (s) => paint('dim', s),
    red: (s) => paint('red', s),
    green: (s) => paint('green', s),
    yellow: (s) => paint('yellow', s),
    cyan: (s) => paint('cyan', s),

    print(s = '') {
      stdout.write(s + '\n');
    },
    warn(s) {
      stderr.write(paint('yellow', 'warning:') + ' ' + s + '\n');
    },
    error(s) {
      stderr.write(paint('red', 'error:') + ' ' + s + '\n');
    },
    hint(s) {
      stderr.write(paint('dim', 'hint:') + ' ' + s + '\n');
    },

    // rows: array of arrays of strings; headers: array of strings.
    table(headers, rows) {
      const all = [headers, ...rows];
      const widths = headers.map((_, i) => Math.max(...all.map((r) => String(r[i] ?? '').length)));
      const fmt = (row) => row.map((cell, i) => String(cell ?? '').padEnd(widths[i])).join('  ').trimEnd();
      ui.print(ui.bold(fmt(headers)));
      ui.print(ui.dim(widths.map((w) => '-'.repeat(w)).join('  ')));
      for (const row of rows) ui.print(fmt(row));
    },

    // Returns true/false. --yes short-circuits; non-interactive defaults to false.
    async confirm(question) {
      if (yes) return true;
      if (!stdin.isTTY) return false;
      const rl = readline.createInterface({ input: stdin, output: stderr });
      try {
        const answer = await new Promise((resolve) => rl.question(`${question} [y/N] `, resolve));
        return /^y(es)?$/i.test(answer.trim());
      } finally {
        rl.close();
      }
    },
  };
  return ui;
}
