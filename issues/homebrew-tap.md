# Publish Beet via Homebrew

**Refs:** §12 (distribution) · builds on `.github/workflows/release.yml` · interacts with #10 (updater)

## Goal

Let people install and upgrade Beet with:

```sh
brew install --cask evanhalley/tap/beet
brew upgrade --cask beet
```

The cask should update automatically on every release, so nobody has to bump it by hand.

## Constraints (as of Sept 2026)

- **The official `homebrew/cask` repo is not an option yet.** Since Homebrew 5, casks that fail Gatekeeper (unsigned or not notarized) are deprecated, and on 2026-09-01 they were disabled. `brew install --no-quarantine` was removed in the same change. Beet's DMG is unsigned, so it can't go in the official repo. `homebrew/cask` also has a notability bar for self-submitted apps that Beet doesn't meet yet.
- **A personal tap is fine.** Homebrew doesn't apply those audits to third-party taps. The tap repo has to be named `homebrew-<something>`, so `evanhalley/homebrew-tap` gives `evanhalley/tap/beet`.
- **Homebrew still quarantines everything it downloads,** so an unsigned Beet installed from the tap would be blocked the same way the DMG is. The cask has to remove the quarantine flag itself in a `postflight_steps` block. The older `postflight do … end` form still works but has printed a deprecation warning since Homebrew 7.0. `postflight_steps` needs Homebrew ≥ 6.0.16.
- **Release artifacts are Apple Silicon only** (`Beet_<v>_aarch64.dmg`), so the cask needs `depends_on arch: :arm64` until we build a universal binary.

## Phase 1: personal tap, unsigned (no Apple account needed)

1. **Create the repo `evanhalley/homebrew-tap`** (public, MIT) with `Casks/beet.rb`:

   ```ruby
   cask "beet" do
     version "0.3.0"
     sha256 "e5489cc69cc343f7c7e157e92204f08f6a92c858c7f3201d8cd628937eadbfef"

     url "https://github.com/evanhalley/beet/releases/download/v#{version}/Beet_#{version}_aarch64.dmg"
     name "Beet"
     desc "Menu bar dashboard for GitHub PRs, checks and workflow runs"
     homepage "https://beet.sh"

     livecheck do
       url :url
       strategy :github_latest
     end

     depends_on arch: :arm64

     app "Beet.app"

     # Beet isn't Developer ID signed/notarized yet; without this Gatekeeper
     # refuses to launch it. Remove once Phase 2 lands.
     postflight_steps do
       run "xattr", args: ["-dr", "com.apple.quarantine", "#{appdir}/Beet.app"],
           must_succeed: false,
           writable_paths: "#{appdir}/Beet.app"
     end

     zap trash: [
       "~/Library/Application Support/dev.evanhalley.beet",
       "~/Library/Caches/dev.evanhalley.beet",
       "~/Library/Preferences/dev.evanhalley.beet.plist",
       "~/Library/WebKit/dev.evanhalley.beet",
     ]
   end
   ```

   Before merging, check the `postflight_steps` sandbox arguments (`writable_paths`) against the current Homebrew cask cookbook. That API is new, and the example above follows how other taps use it, not the official docs. Also check the `zap` paths on a real install (`ls ~/Library/*/dev.evanhalley.beet*`).

2. **Automate cask bumps from `release.yml`.** After the `Create GitHub Release` step:
   - `shasum -a 256` the DMG that was just built.
   - Check out `evanhalley/homebrew-tap` with a separate credential. `GITHUB_TOKEN` can't push to another repo, so use either a write deploy key on the tap (`HOMEBREW_TAP_DEPLOY_KEY`) or a fine-grained PAT scoped to that one repo with `contents: write`. The deploy key matches the existing `RELEASE_DEPLOY_KEY` pattern and is narrower, so that's the recommendation.
   - Rewrite the `version` and `sha256` lines, commit `beet <version>`, and push to the tap's `main`.
   - If this step fails, the GitHub Release is already published, so the failure just leaves the cask one version behind. That's acceptable. Re-running the job step will fix it.

3. **Validate the tap** (manually once, then optionally as CI in the tap repo on `macos-latest`):
   - `brew audit --cask --strict evanhalley/tap/beet` (third-party taps can skip the signing audit)
   - `brew install --cask evanhalley/tap/beet`, then confirm `xattr -l /Applications/Beet.app` shows no `com.apple.quarantine` and that the app launches
   - `brew uninstall --zap --cask beet` leaves nothing behind

4. **Docs:** add a "Homebrew" install option above the DMG steps in the README and on beet.sh. Brew users can skip the `xattr` step because the cask does it for them.

## Phase 2: sign + notarize (needs the $99/yr Apple Developer Program)

This is the real fix. It removes the `xattr` step from the docs and the `postflight_steps` block from the cask, and it's required before Beet can ever go into the official `homebrew/cask`.

- Create a **Developer ID Application** certificate and an App Store Connect API key.
- Tauri's bundler signs and notarizes during `tauri build` when these secrets are set in `release.yml`: `APPLE_CERTIFICATE`, `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY`, and either (`APPLE_API_KEY`, `APPLE_API_ISSUER`, API key `.p8`) or (`APPLE_ID`, `APPLE_PASSWORD`, `APPLE_TEAM_ID`).
- Afterwards, remove `postflight_steps` from the cask and the quarantine section from the README and landing page (#58).
- Optional: build `--target universal-apple-darwin` and drop `depends_on arch: :arm64` so Intel Macs are supported.
- Later: submit to `homebrew/cask` once Beet clears the notability bar. The tap can stay up for people who already use it.

## Interaction with the updater (#10)

When `tauri-plugin-updater` ships, add `auto_updates true` to the cask. That tells `brew upgrade` to leave Beet alone (unless `--greedy` is passed), so Homebrew doesn't fight the in-app updater. Homebrew's metadata can lag behind the real installed version, which is expected for any app that updates itself.

## Acceptance criteria

- [ ] `evanhalley/homebrew-tap` exists with `Casks/beet.rb` at the current release
- [ ] `brew install --cask evanhalley/tap/beet` installs a Beet that launches with no Gatekeeper prompt
- [ ] `brew audit --cask --strict` passes for the tap
- [ ] `release.yml` updates `version` + `sha256` in the tap after each release, using a credential scoped to the tap only
- [ ] `brew upgrade --cask beet` picks up a new release without manual edits
- [ ] README + beet.sh document the Homebrew install path
- [ ] (Phase 2) Signed + notarized DMG; quarantine workaround removed from the cask and docs
