# beet

A glanceable, always-running developer dashboard for GitHub. macOS menu-bar app built on Tauri 2 + Next.js. See [SPECS.md](SPECS.md) for the full product spec and [ISSUES.md](ISSUES.md) for the V1 build plan.

Landing page: **[beet.sh](https://beet.sh)** (source in [docs/](docs/), published by GitHub Pages from `main`).

## Install

1. Download the latest `Beet_<version>_aarch64.dmg` from [GitHub Releases](https://github.com/evanhalley/beet/releases/latest) (Apple Silicon only for now).
2. Open the DMG and drag **Beet** into **Applications**.
3. Clear the quarantine attribute before the first launch:

   ```sh
   xattr -dr com.apple.quarantine /Applications/Beet.app
   ```

4. Launch Beet from Applications or Spotlight. It lives in the menu bar.

**Why step 3?** Beet isn't signed with an Apple Developer ID or notarized yet. macOS tags anything downloaded through a browser with the `com.apple.quarantine` extended attribute, and Gatekeeper refuses to open quarantined apps it can't verify. You'll see *"Beet is damaged and can't be opened"* or *"Apple could not verify Beet is free of malware"*. The app isn't actually damaged; that's just Gatekeeper's wording for an unverified download. Since macOS 15 Sequoia, the old right-click → **Open** bypass no longer works. Your two options are the `xattr` command above, or trying to open the app once and then going to **System Settings → Privacy & Security** and clicking **Open Anyway**.

`xattr -dr` only removes the quarantine flag from `Beet.app` (`-d` deletes the attribute, `-r` recurses into the bundle). It doesn't turn Gatekeeper off system-wide. To check it worked, run `xattr -l /Applications/Beet.app`: `com.apple.quarantine` should no longer be listed.

You'll need to repeat step 3 after installing each new version from a DMG.

## Commands

### npm (frontend + Tauri orchestration)

```sh
npm install                # install JS deps
npm run dev                # Next.js dev server only
npm run build              # Next.js static export → out/
npm run lint               # ESLint
npm test                   # Vitest (run once)
npm run tauri dev          # boot Next.js + Tauri shell in dev mode
npm run tauri:mock         # same, in demo mode (fixture data, no PAT/network)
npm run tauri build        # release build → src-tauri/target/release/bundle/macos/Beet.app + .dmg
```

### Demo mode

`npm run tauri:mock` boots the full app with `BEET_MOCK=1`: the Rust poller serves bundled fixture data instead of calling GitHub, so no personal access token and no network are needed. Useful for trying out or demoing the UI. Quit any running Beet first — the single-instance guard will otherwise just focus the existing app.

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
