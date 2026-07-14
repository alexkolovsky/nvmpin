# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-07-15

Initial release. Design rationale for the choices below lives in
[DECISIONS.md](DECISIONS.md) (repo only, not shipped in the package).

### Added

- **Pinning model**: pin any globally-installed npm package to a specific
  nvm-managed node version. nvmpin generates one bash shim per declared bin
  into `~/.nvmpin/bin` (prepended to `PATH`), each baking in the absolute path
  to the pinned version's `node` — pinned CLIs keep working no matter which
  node version is currently active.
- `nvmpin setup` — create the shim dir and print (and, for bash/zsh, offer to
  append) the shell rc `PATH` line. Idempotent.
- `nvmpin add <pkg>[@<ver>] --node <ver>` — install under the target version
  if needed, write shims, record the pin. Suggests a version from
  `engines.node` when `--node` is omitted; warns (never blocks) on engines
  conflicts.
- `nvmpin remove <pkg> [--uninstall]` — drop shims and the pin;
  `--uninstall` also removes the package from that version's global tree.
- `nvmpin move <pkg> --node <ver>` — full reinstall into the new version
  (native modules are ABI-specific), with registry/shim rollback on failure.
- `nvmpin list [--json]` — pins with health status
  (`ok` / `broken shim` / `node version missing`).
- `nvmpin scan [--json]` — every global package across all installed nvm
  versions: duplicates and unpinned candidates.
- `nvmpin exec <pkg> -- <args...>` — run a pinned package's main bin directly
  with its pinned node, bypassing `PATH`.
- `nvmpin doctor` — verifies `PATH` ordering (shim dir before all nvm bin
  dirs), pinned versions still installed, shim/registry agreement (no
  orphans, no drift), and registry validity; exits `2` with fix suggestions
  when problems are found.
- Installs always run the **target version's own node and npm**, with the
  target bin dir first in `PATH` (correct ABI for native builds) and
  `npm_config_prefix` asserted to the target version dir (defeats stray
  prefix overrides from env or npmrc).
- Corrupt `pins.json` handling: write commands back it up and start fresh;
  read-only commands refuse to touch it and point at `doctor`.
- Zero runtime dependencies; node >= 18; `--json`, `--yes`, `--no-color`
  (and `NO_COLOR`) global flags.

### Known limitations

- POSIX only (macOS/Linux, bash/zsh shims) — no Windows support.
- nvm aliases (`lts/hydrogen`, `stable`, …) are rejected; use numeric
  versions.
- Moving a pin to another node version is always a full reinstall — compiled
  addons are ABI-specific, so there is no fast re-point.
- Deleting a pinned node version breaks its pins; `doctor`/`list` report it,
  `move` fixes it.
- Only common `engines.node` range syntax is evaluated; exotic ranges are
  skipped with a warning rather than misjudged.

[0.1.0]: https://github.com/alexkolovsky/nvmpin/releases/tag/v0.1.0
