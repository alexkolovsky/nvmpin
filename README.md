# nvmpin

**Keep your global CLIs working across nvm version switches.**

nvm silos globally-installed npm packages per node version: run `nvm use 20` and every CLI you installed under node 18 vanishes from your PATH. nvmpin fixes this without asking you to leave nvm — it pins each global package to a specific nvm-managed node version and generates tiny bash shims so the CLI is always on your PATH, always running on the node version it was built for.

```console
$ nvm use 20
$ tsc --version        # installed under node 18
zsh: command not found: tsc

$ nvmpin add typescript --node 18
pinned typescript -> node v18.20.4 (bins: tsc, tsserver)

$ nvm use 20 && tsc --version
Version 5.4.5           # still works
```

- **Zero runtime dependencies.** Pure node stdlib.
- **nvm-native.** Works with your existing `$NVM_DIR` layout; never shells out to nvm; changes nothing about how you use nvm.
- **Correct npm.** Installs always use the *target* node version's own node + npm, so native modules compile against the right ABI.

## nvmpin vs Volta

[Volta](https://volta.sh) solves this problem more completely: it pins node versions per project, hooks package managers, and manages toolchains end to end. If you're happy to replace nvm, use Volta — it's the more mature tool.

nvmpin is for people **staying on nvm**: your team standardizes on it, your dotfiles assume it, or you just don't want to migrate. nvmpin adds one missing capability — per-package version pinning for global CLIs — on top of the nvm install you already have, and nothing else.

## Quickstart

Requires node >= 18, nvm, and a POSIX shell (macOS/Linux, bash/zsh). Windows is not supported.

```console
$ npm install -g nvmpin
$ nvmpin setup
```

`setup` creates `~/.nvmpin/bin` and prints (and offers to append) the one line you need in your shell rc, **after nvm's init lines**:

```bash
export PATH="$HOME/.nvmpin/bin:$PATH" # nvmpin
```

Then pin something:

```console
$ nvmpin add typescript --node 18      # installs under v18.x if needed, writes shims
$ nvmpin list                          # see your pins and their health
$ nvmpin doctor                        # verify PATH order, shims, registry
```

## Command reference

| Command | What it does |
| --- | --- |
| `nvmpin setup` | Create dirs and print the shell rc PATH snippet. Offers to append it for bash and zsh; other shells get the snippet with a note to add the equivalent manually. Idempotent. |
| `nvmpin add <pkg>[@<ver>] --node <v>` | Install the package under that node version (if not already there), write shims for every bin it declares, record the pin. If `--node` is omitted, nvmpin suggests a version from the package's `engines.node` — this only works when the package is already installed under *some* nvm version (reading `engines` without installing would need a registry call); otherwise it errors listing your installed versions. Conflicting `engines.node` produces a warning, not a failure. Re-pinning an already-pinned package to a *different* version is rejected — use `move`. |
| `nvmpin remove <pkg> [--uninstall]` | Delete the shims and the registry entry. `--uninstall` also removes the package from the node version's global tree. |
| `nvmpin move <pkg> --node <v>` | Full reinstall into the new version (never a re-point — native modules are compiled per node ABI), rewrite shims, update the registry. Keeps the currently-installed package version (`pkg@X.Y.Z`), not npm's latest. Rolls back registry and shims on failure. |
| `nvmpin list [--json]` | Table of pins: package, node version, bins, status (`ok` / `broken shim` / `node version missing`). |
| `nvmpin scan [--json]` | Walk all installed nvm versions' global trees; report each package, which versions it exists in, duplicates, and unpinned candidates (npm/corepack excluded). |
| `nvmpin exec <pkg> -- <args...>` | Run a pinned package's main bin directly with its pinned node — an escape hatch that bypasses PATH/shims. |
| `nvmpin doctor` | Verify: shim dir on PATH and no pinned bin *shadowed* by an earlier nvm bin dir, every pinned node version still installed, shims match the registry (no orphans, no drift), pins.json valid. Exits `2` with fix suggestions on findings. Doctor distinguishes **findings** (`✗`, exit 2) from **notes** (informational, exit 0): after `nvm use`, that version's bin dir precedes the shims in the live shell — expected and harmless unless it actually contains a pinned bin's name, so doctor prints a note instead of failing. To judge your rc ordering, run doctor in a fresh shell. |

**Global flags:** `--yes` (skip confirmations), `--no-color` (also respects `NO_COLOR`), `--json` (on `list` and `scan`), `--help`/`-h`.

**JSON output:** `list --json` prints an array of pin objects; `scan --json` prints an object with the installed versions and per-package report:

```jsonc
// nvmpin list --json
[
  { "package": "typescript", "node": "v18.20.4", "bins": ["tsc", "tsserver"],
    "pinnedAt": "2026-07-15T10:00:00.000Z", "status": "ok" }
]

// nvmpin scan --json
{ "nodeVersions": ["v20.19.5", "v18.20.4"],
  "packages": [
    { "package": "typescript", "versions": ["v18.20.4", "v20.19.5"],
      "duplicate": true, "pinned": "v18.20.4" }
  ] }
```

**Node version syntax:** `18`, `18.20`, `v18.20.4` — resolved to the newest installed match. nvm aliases (`lts/hydrogen`, `stable`, `default`, …) are not supported; pass a number.

**Exit codes:** `0` ok · `1` user error · `2` environment error (or doctor problems) · `3` internal error. Set `NVMPIN_DEBUG=1` for stack traces.

**Environment:** `NVM_DIR` (default `~/.nvm`), `NVMPIN_HOME` (default `~/.nvmpin`).

## How it works

State lives in `~/.nvmpin`:

```
~/.nvmpin/
  pins.json    # the registry: package -> { node version, bins, pinnedAt }
  bin/         # one bash shim per pinned executable, prepended to PATH
```

Each shim bakes in the absolute path to the pinned node version at generation time — no runtime lookups, no nvm invocation:

```bash
#!/usr/bin/env bash
# nvmpin shim for typescript -> v18.20.4 (do not edit)
exec "/Users/you/.nvm/versions/node/v18.20.4/bin/node" "/Users/you/.nvm/versions/node/v18.20.4/lib/node_modules/typescript/bin/tsc" "$@"
```

Because `~/.nvmpin/bin` sits ahead of nvm's bin dir in PATH, the shim wins no matter which node version is active.

**If `pins.json` gets corrupted:** write commands (`add`, `remove`, `move`) back it up to `pins.json.corrupt-<timestamp>`, warn, and start fresh; read-only commands (`list`, `scan`, `exec`) refuse to touch it and exit `2` pointing at `doctor`, which reports the corruption (and any now-orphaned shims, with a pointer to the backup) without modifying anything.

## Limitations

- **POSIX only.** macOS and Linux with bash/zsh shims. No Windows support in v1.
- **No nvm aliases.** `--node lts/hydrogen` is rejected; use a numeric version. Aliases move over time, which would silently break pins.
- **Native modules require `nvmpin move`.** Switching a pin to a new node version is always a full reinstall, because compiled addons are ABI-specific. There is no fast re-point.
- **Deleting a node version breaks its pins.** `nvmpin doctor` and `nvmpin list` will tell you; fix with `nvmpin move`.
- **Common `engines.node` ranges only.** Exotic semver ranges in `engines.node` are never guessed at: they're skipped on the suggestion path, and produce a one-line "couldn't verify" warning when you passed `--node` explicitly.

## Development

```console
$ npm test                          # unit suite: offline, stub-based, fast
$ NVMPIN_INTEGRATION=1 npm test     # also runs the real-npm integration test
$ npm run test:integration          # same thing, spelled out
```

The integration test installs a small pinned package from the **real npm registry** into a tmp-dir sandbox to re-verify the npm behavior nvmpin's installer depends on (env-prefix precedence, config passthrough). It needs network access and takes a minute or two; it runs automatically on `npm publish` via `prepublishOnly` and shows as *skipped* in ordinary test runs.

## License

MIT — see [LICENSE](LICENSE).
