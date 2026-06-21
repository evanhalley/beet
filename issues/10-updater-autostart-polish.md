# #10 — Updater + autostart + final polish

The closing iteration. Wire `tauri-plugin-updater` against the GitHub Releases manifest produced by [#12](https://github.com/evanhalley/beet/issues/12), add the opt-in launch-at-login toggle, and finish the polish items (task chips, pin glyph, density, theme, score toggle) so every checkbox in [SPECS §16](../SPECS.md) is green.

Refs: [SPECS §3 plugins](../SPECS.md), [§11 settings](../SPECS.md), [§12 auto-update + autostart + single-instance](../SPECS.md), [§16 V1 acceptance criteria](../SPECS.md). Builds on the release workflow from [#12](https://github.com/evanhalley/beet/issues/12) and everything before it.

## Goal

Launching Beet (or every 24 h thereafter) checks GitHub Releases for a newer signed manifest. When one is available, the main window shows a non-blocking banner ("Update to vX.Y.Z available — Restart now / Later") and the tray menu gets a "Restart to update" item. Restart calls `update.downloadAndInstall()` and the user lands on the new build. The Settings → General tab now has an "Open at login" toggle. Task chips, the pin glyph, density / theme toggles, and the score-on-row toggle from §11 are all wired. Every line in §16 verifies.

## Acceptance criteria

### Updater

- [ ] **Add `tauri-plugin-updater`** to `src-tauri/Cargo.toml` and `package.json`. Initialize in `lib.rs` builder.
- [ ] **Generate updater key pair.** `cargo tauri signer generate -w ~/.tauri/beet-updater.key` (one-time, by the maintainer). Public key goes in `tauri.conf.json` under `plugins.updater.pubkey`. Private key never enters the repo — it lives only in the release machine and as `TAURI_SIGNING_PRIVATE_KEY` / `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` GitHub Actions secrets.
- [ ] **`tauri.conf.json` `plugins.updater.endpoints`** points at the GitHub Releases `updates.json` asset URL (templated for `{{target}}` / `{{arch}}` / `{{current_version}}`).
- [ ] **`src/hooks/useUpdater.ts`** — calls `check()` on app boot (after a 5 s delay so the UI lands first) and every 24 h. Exposes `{ available: boolean, version?: string, restart: () => Promise<void> }`.
- [ ] **`src/components/UpdateBanner.tsx`** — non-blocking banner at the top of MainWindowShell when `available`. Buttons: Restart now (calls `restart()`), Later (dismisses for this session).
- [ ] **Tray menu** (extend #7) — when `available`, insert "Restart to update {version}" above the separator. Same `restart()` call.
- [ ] **Release CI** — extend `.github/workflows/release.yml` to:
  - Build signed DMG with `tauri-action` (which already produces the signed manifest when `TAURI_SIGNING_PRIVATE_KEY` is set).
  - Upload both the DMG and `latest.json` (the manifest tauri-action produces) as release assets.
  - Rename `latest.json` → `updates.json` on the release (or update the endpoint to match — pick one convention and document it in the workflow comment).
- [ ] **No silent restarts.** The user-initiated restart path is the only one; `useUpdater` does not auto-restart.

### Autostart

- [ ] **Add `tauri-plugin-autostart`** to `Cargo.toml`. Initialize in `lib.rs` with `MacosLauncher::LaunchAgent`.
- [ ] **Settings → General → "Open Beet at login" toggle.** On toggle: call `enable()` / `disable()`. Reflect current state on mount via `isEnabled()`. Default off.

### Polish (the §16 sweep)

- [ ] **Task chips.** Port PRZ's task-URL regex extraction from github.ts into `src/lib/tasks.ts`. Render up to 3 chips on the PR row from `pr.taskUrls`, with a `+N` overflow chip; clicking a chip opens the ticket via `tauri-plugin-shell`. Full list rendered in the DetailPane's Body tab. Regex is user-configurable in Settings → General (default: the Atlassian pattern from PRZ).
- [ ] **PinGlyph** (carried from #9) is rendered in the row's repo-label chrome for pinned repos.
- [ ] **Density toggle.** Settings → Appearance → Compact / Comfy. Toggles a `data-density` attribute on the root container; Tailwind utility classes branch on `[data-density=compact]:py-1 [data-density=comfy]:py-2` etc.
- [ ] **Theme.** Settings → Appearance → Auto / Light / Dark. `auto` follows `prefers-color-scheme`; the other two pin. Implemented by toggling the `dark` class on `<html>`.
- [ ] **Show priority score toggle.** Settings → Appearance → Show priority score on rows (default on). When off, the `ScoreBar` is hidden from review-request rows.

### Acceptance sweep

- [ ] **Walk every checkbox in [SPECS §16](../SPECS.md)** against the running app on macOS. Flag any item that doesn't pass; either fix in this PR or open a follow-up issue and check off only the items that genuinely pass.

## Files to add / modify

```
src-tauri/
├── Cargo.toml                        ← + tauri-plugin-updater, tauri-plugin-autostart
├── tauri.conf.json                   ← updater pubkey + endpoints; autostart plugin entry
└── src/lib.rs                        ← initialize both plugins

src/
├── hooks/useUpdater.ts               ← new
├── hooks/useUpdater.test.tsx         ← new
├── components/
│   ├── UpdateBanner.tsx              ← new
│   ├── UpdateBanner.test.tsx         ← new
│   ├── TaskChips.tsx                 ← new
│   ├── TaskChips.test.tsx            ← new
│   ├── Settings/
│   │   ├── AppearanceTab.tsx         ← theme, density, score toggle
│   │   ├── AppearanceTab.test.tsx
│   │   └── GeneralTab.tsx            ← autostart toggle, task URL regex
│   └── MainWindow/MainWindowShell.tsx ← mount UpdateBanner
├── lib/
│   ├── tasks.ts                      ← URL → task-id regex extraction (port from PRZ)
│   └── tasks.test.ts                 ← new (covers PRZ's existing test cases)
└── app/globals.css                   ← density + theme tokens

.github/workflows/release.yml         ← updater manifest publish (extends #12)
```

## Test plan

**Unit (Vitest)**
- `tasks.test.ts` — port PRZ's existing test cases verbatim, then add a configurable-regex case.
- `useUpdater.test.tsx` — mock `@tauri-apps/plugin-updater`; `available = false` → no banner; `available = true` → banner + restart wires to `downloadAndInstall`.
- `AppearanceTab.test.tsx` — toggling density / theme flips the right attributes on the document root.

**Manual**
- Bump version in `package.json` + `tauri.conf.json` to e.g. `0.1.2`; build + sign locally; serve a fake `updates.json` pointing at a real previous build.
- Launch the older build → banner appears within 5 s; tray menu has "Restart to update". Restart → new build launches.
- Toggle "Open at login" → log out & back in → Beet starts hidden in the tray.
- Settings → Appearance toggles flip immediately without restart.
- Open a PR with a JIRA-style task URL in the description → chips render on the row + full list in DetailPane.
- Walk §16 top to bottom — every box ticks.

## Out of scope (deferred to post-V1)

| Concern | Where |
|---|---|
| Beta channel for updater | V2 |
| Webhook / GitHub App auth | V2 |
| Windows / Linux ports | V2 |
| Saved views / custom dashboards | V2 |

## Notes

- **`latest.json` vs `updates.json`.** `tauri-action` defaults to `latest.json`; the spec says `updates.json`. Either is fine — match the endpoint URL in `tauri.conf.json` to whatever the release workflow uploads. Document the chosen filename inline in the workflow.
- **Private key safety.** Double-check the workflow secrets aren't echoed; `tauri-action` masks them by default but a stray `set -x` in a custom step can leak. Audit the workflow before this PR merges.
- **Updater + autostart interaction.** If a user opts into autostart and an update lands while the app is closed, the next login boot will trigger the banner within 5 s. No special "update on launch" path — the regular `check()` flow handles it.
- **PRZ regex behavior.** PRZ's default pattern is opinionated toward Atlassian URLs. The configurable regex in Settings should ship with that as the default but accept any user-supplied pattern; validate it parses before saving (try/catch around `new RegExp`).
- **§16 sweep is the gate.** Don't merge this PR until every box in §16 is checked. If something doesn't pass, decide explicitly: fix here, open a follow-up, or amend the spec.
