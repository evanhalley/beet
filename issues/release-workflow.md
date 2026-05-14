# Release Workflow + App Versioning

**Refs:** §12 (Updater, autostart, polish) · builds on existing `.github/workflows/ci.yml`

## Goal

Set up a GitHub Actions workflow that fires on every merge to `main`, builds the macOS app, and publishes a versioned GitHub Release with the `.dmg` attached. Also establishes the app versioning strategy — `YYYY.NN` — so version numbers are meaningful, predictable, and computed automatically without any manual steps.

## Versioning strategy

Format: `YYYY.NN`

- `YYYY` — calendar year of the release (e.g. `2026`)
- `NN` — zero-padded release index within that year, starting at `01`, resetting to `01` on year rollover
- Examples: `2026.01` → `2026.02` → `2026.03` → … → `2027.01`
- Git tags use a `v` prefix: `v2026.01`, `v2026.02`, …
- The workflow computes the next version automatically by listing existing tags matching `v${YEAR}.*`; no human input required

## Acceptance criteria

- [ ] `release.yml` triggers on every push to `main`
- [ ] Workflow auto-computes `YYYY.NN` from existing git tags; no version needs to be set manually
- [ ] `src-tauri/tauri.conf.json` `.version` is patched to the computed version before the build runs
- [ ] A git tag `vYYYY.NN` is created and pushed as part of the release
- [ ] `npm run tauri build` succeeds and produces a `.dmg` in `src-tauri/target/release/bundle/dmg/`
- [ ] A GitHub Release is created with the computed tag and auto-generated release notes (commits since the previous tag)
- [ ] The `.dmg` is attached to the release as a downloadable artifact
- [ ] Workflow has `concurrency` guard to prevent double-releases on the same SHA
- [ ] Existing `ci.yml` continues to run on PRs and pushes to `main` unchanged

## Files to add / modify

```
.github/
  workflows/
    release.yml          ← new
src-tauri/
  tauri.conf.json        ← .version managed by workflow going forward
issues/
  release-workflow.md    ← this file
```

## Workflow shape

```yaml
name: Release

on:
  push:
    branches: [main]

concurrency:
  group: release-${{ github.sha }}
  cancel-in-progress: true

jobs:
  release:
    runs-on: macos-latest
    permissions:
      contents: write   # required to create releases + push tags

    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0  # full history needed for tag enumeration

      # ── Compute next YYYY.NN version ──────────────────────────────────
      - name: Compute version
        id: version
        run: |
          YEAR=$(date +%Y)
          LATEST=$(git tag --list "v${YEAR}.*" --sort=-version:refname | head -1)
          if [ -z "$LATEST" ]; then
            NN=01
          else
            PREV_NN="${LATEST##*.}"
            NN=$(printf "%02d" $((10#$PREV_NN + 1)))
          fi
          VERSION="${YEAR}.${NN}"
          echo "VERSION=${VERSION}" >> "$GITHUB_OUTPUT"
          echo "TAG=v${VERSION}"    >> "$GITHUB_OUTPUT"

      # ── Patch tauri.conf.json ─────────────────────────────────────────
      - name: Patch version in tauri.conf.json
        run: |
          jq --arg v "${{ steps.version.outputs.VERSION }}" \
             '.version = $v' src-tauri/tauri.conf.json > _tmp.json
          mv _tmp.json src-tauri/tauri.conf.json

      # ── Node + Rust toolchain (mirrors ci.yml) ────────────────────────
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - uses: dtolnay/rust-toolchain@stable

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri -> target

      - run: npm ci

      # ── Build ─────────────────────────────────────────────────────────
      - name: Build Tauri app
        run: npm run tauri build

      # ── Tag + Release ─────────────────────────────────────────────────
      - name: Create GitHub Release
        uses: softprops/action-gh-release@v2
        with:
          tag_name: ${{ steps.version.outputs.TAG }}
          name: Beet ${{ steps.version.outputs.VERSION }}
          generate_release_notes: true   # auto-generates notes from commits since last tag
          files: src-tauri/target/release/bundle/dmg/*.dmg
```

## Dependencies to add

**`package.json`** — none (workflow-only change)

**GitHub Actions marketplace:**
- `softprops/action-gh-release@v2` — creates the release and uploads assets

## Test plan

### Manual
1. Merge a branch to `main` and confirm the workflow triggers
2. Check the Actions tab — "Compute version" step should print `VERSION=YYYY.NN`
3. Confirm `tauri.conf.json` version matches in the build log
4. Confirm a GitHub Release appears at `github.com/evanhalley/beet/releases` with the correct tag
5. Download the attached `.dmg`, mount it, and verify Beet opens
6. Merge a second branch; confirm NN incremented (e.g. `2026.01` → `2026.02`)
7. Simulate year rollover by temporarily tagging `v2025.99` and confirming `2026.01` is computed for the current year

### Unit
No unit tests needed — this is pure CI infrastructure.

## Out of scope (deferred)

| Concern | Deferred to |
|---|---|
| Apple codesigning + Gatekeeper notarization | Issue #10 (Updater + polish) |
| Tauri updater signing key pair (public key in `tauri.conf.json`, private in CI secrets) | Issue #10 |
| Universal binary (`arm64` + `x86_64` → `universal-apple-darwin`) | Issue #10 or separate |
| Changelog tooling beyond GitHub auto-generated notes | Future |
| Windows / Linux builds | Out of V1 scope (§13) |

## Notes

- `fetch-depth: 0` is required in the checkout step; without full history `git tag --list` only sees tags reachable from HEAD's shallow clone
- `permissions: contents: write` must be set at the job level (or workflow level) for `GITHUB_TOKEN` to create releases
- The `jq` patch approach is safe — `jq` is pre-installed on `macos-latest` GitHub runners
- `generate_release_notes: true` on `softprops/action-gh-release` uses GitHub's compare-against-previous-tag logic; no changelog config file needed
- Do **not** set `tauri.conf.json` version to a static value going forward — the workflow owns it
- Once issue #10 wires up `tauri-plugin-updater`, the release workflow will need to add the updater bundle signature step (using the private key from CI secrets); leave a `# TODO(#10)` comment at that insertion point
