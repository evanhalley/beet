# beet

A glanceable, always-running developer dashboard for GitHub. macOS menu-bar app built on Tauri 2 + Next.js. See [SPECS.md](SPECS.md) for the full product spec and [ISSUES.md](ISSUES.md) for the V1 build plan.

## Commands

### npm (frontend + Tauri orchestration)

```sh
npm install                # install JS deps
npm run dev                # Next.js dev server only
npm run build              # Next.js static export → out/
npm run lint               # ESLint
npm test                   # Vitest (run once)
npm run tauri dev          # boot Next.js + Tauri shell in dev mode
npm run tauri build        # release build → src-tauri/target/release/bundle/macos/Beet.app + .dmg
```

### cargo (Rust side, run from repo root)

All cargo commands target the Tauri crate via `--manifest-path`. CI uses `--locked` to fail on `Cargo.lock` drift; locally you can omit it.

```sh
# Debug build of the Rust binary (what `tauri dev` consumes).
cargo build --manifest-path src-tauri/Cargo.toml

# Same, with --locked — matches CI. Run before pushing if you touched Cargo.toml.
cargo build --manifest-path src-tauri/Cargo.toml --locked

# Rust lint. CI runs this with -D warnings, so any warning fails the build.
cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings

# Force a rebuild of just the Beet crate. Useful when icons or other embedded
# resources change but cargo's incremental detection misses it (the Tauri
# `generate_context!` macro embeds icons referenced from tauri.conf.json).
cargo clean -p beet --manifest-path src-tauri/Cargo.toml

# Regenerate the icon set from design/beet-mark.svg.
npx tauri icon design/beet-mark.svg
```

After regenerating icons, `cargo clean -p beet` + a fresh `npm run tauri dev` is the reliable way to flush the embedded icon. macOS may also cache the Dock icon by bundle ID — `killall Dock` clears it.

## Platform

macOS only in V1 (per [SPECS.md §13](SPECS.md)). Tauri can produce Windows/Linux artifacts as a build by-product, but they are not tested or supported.
