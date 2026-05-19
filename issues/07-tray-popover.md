# #7 — Tray popover + window-close-≠-quit

Light up Beet's primary surface: the macOS menu-bar tray icon + popover. Up to this point we've been validating the data layer in a regular window; this issue makes the app feel like the always-on ambient dashboard that [SPECS §1](../SPECS.md) describes. It also wires window-close-≠-quit so closing the main window leaves polling running.

Refs: [SPECS §2](../SPECS.md) (two coordinated surfaces), [§11 tray popover mock](../SPECS.md), [§12 app lifecycle](../SPECS.md). Builds on the data-layer work in [#6](https://github.com/evanhalley/beet/issues/22).

## Goal

Click the beet 🫜 icon in the macOS menu bar → a 360×480 popover appears anchored under the icon, showing the five sections from §11 (Needs Action / Review Requests / In Flight / Standalone Runs / Recently Resolved) reading from the same `useAppStore` as the main window. Right-click reveals a menu with Open Beet / Refresh now / Pause polling / Settings / Quit. The badge text on the icon equals the unread count from Needs Action Now + Review Requests. Closing the main window hides it instead of quitting; the tray, polling, and notifications keep running.

## Acceptance criteria

### Tray (Rust)

- [ ] **`src-tauri/src/tray.rs`** — `TrayIconBuilder` builds the macOS tray with a beet glyph (PNG asset, template-rendered so it adapts to light/dark menu bar). `set_title("")` reserved for the badge count. Tooltip `"Beet 🫜"`.
- [ ] **Tray menu** — right-click items: `Open Beet`, `Refresh now`, `Pause polling` (toggle, displays `Resume polling` when paused), `Settings`, separator, `Quit`. Wire each to a Tauri command emitted to the frontend (`open-main`, `refresh`, `toggle-pause`, `open-settings`) except `Quit` which calls `app.exit(0)` directly.
- [ ] **Left-click handler** — toggle the popover window. Position it anchored to the tray icon (`TrayIconEvent::Click { position, .. }` → set popover window position).
- [ ] **`set_badge(count: u32)` Tauri command** — sets `tray.set_title(if count == 0 { "" } else { &count.to_string() })`. Pause state renders the title with a leading pause glyph (e.g. `⏸ 3`).

### Popover window

- [ ] **Second WebviewWindow** declared in `tauri.conf.json` with `label: "tray"`, `width: 360`, `height: 480`, `decorations: false`, `transparent: true`, `resizable: false`, `skipTaskbar: true`, `visible: false`. Loaded URL points at `/tray` from the static export.
- [ ] **`src/app/tray/page.tsx`** — new Next.js route that mounts `<TrayPopover>`. Reuses the existing Providers (Zustand + TanStack Query) so it shares state with the main window's queries.
- [ ] **`src/components/TrayPopover.tsx`** — five-section list mirroring §11's mock. Reads `useAppStore` selectors that are already populated by the main window's polling. Each row click → `tauri-plugin-shell` `open(item.url)`. Section headers show the count + collapsible chevron (state in Zustand, persisted with the existing settings storage).
- [ ] **Auto-dismiss on blur** — when the popover loses focus, hide it (matches macOS menu-bar UX). Implemented via window event listener in `tray.rs`.

### Window-close-≠-quit

- [ ] **Intercept `WindowEvent::CloseRequested`** on the main window in `src-tauri/src/lib.rs`: `api.prevent_close()` + `window.hide()`. Dock icon is hidden via `app.set_activation_policy(ActivationPolicy::Accessory)` so closing the window removes Beet from the Dock but keeps the tray.
- [ ] **Tray `Quit` is the only exit path** — `app.exit(0)`. Verify polling threads / Tauri command channels shut down cleanly.
- [ ] **`tauri-plugin-single-instance`** (wired in #1) — verify second-launch focuses the existing instance's main window (calls `window.show()` + `window.set_focus()`).

### Badge + pause wiring

- [ ] **`useTrayBadge` hook** — subscribes to `useAppStore` for `needsAction.unreadCount + reviewRequests.unreadCount`; on change, invokes the `set_badge` Tauri command. Debounced to avoid thrashing the tray during burst polls.
- [ ] **`isPaused` flag** in `src/lib/store.ts` — read by every TanStack Query as `enabled: !isPaused`. Toggle from tray menu emits `toggle-pause` event; frontend flips the flag. The poller in `src-tauri` also checks a Rust-side `Arc<AtomicBool>` mirrored from the same toggle so the Rust poll loop pauses too.
- [ ] **Pause glyph** — when `isPaused`, the tray title prefix is `⏸ `; when active, no prefix.

## Files to add / modify

```
src-tauri/
├── src/
│   ├── tray.rs                       ← new: tray icon, menu, events, set_badge command
│   ├── lib.rs                        ← wire tray builder + WindowEvent::CloseRequested
│   └── poller/poll_loop.rs           ← honor pause flag
└── tauri.conf.json                   ← add tray icon path, second WebviewWindow ("tray")

src/
├── app/tray/page.tsx                 ← new route
├── components/TrayPopover.tsx        ← new
├── components/TrayPopover.test.tsx   ← new
├── hooks/useTrayBadge.ts             ← new
├── hooks/useTrayCommands.ts          ← new: listens for tray-emitted events (refresh, toggle-pause, etc.)
└── lib/store.ts                      ← add isPaused + setIsPaused

src-tauri/icons/tray-icon.png         ← new template-rendered icon asset
```

## Test plan

**Unit (Vitest)**
- `TrayPopover.test.tsx` — renders five sections against a fixture store; click a row calls the mocked `open()` from `tauri-plugin-shell`.
- `useTrayBadge.test.tsx` — badge command invoked with the sum of `needsAction.unreadCount + reviewRequests.unreadCount`; not invoked when counts unchanged.
- Pure-function test for the badge-title formatter (`format(count, paused)`).

**Manual (macOS)**
- `npm run tauri dev` against a real PAT — tray icon appears in the menu bar.
- Left-click → popover opens anchored under icon; click outside → it hides.
- Right-click → menu; each item performs the documented action.
- Close the main window (⌘W) → window hides; tray remains; polling continues (verify via network tab or the `PollingDot` indicator on next re-open).
- Re-launch the app while it's running → existing window comes to front (single-instance).
- Tray Quit → process exits.
- Pause polling → tray title shows `⏸`; TanStack Query devtools confirm no refetches; Resume returns normal.

## Out of scope

| Concern | Lands in |
|---|---|
| Real Needs Action Now items (mentions, ejections) populating the section | #8 |
| OS notifications for the 5 §10 triggers | #9 |
| Adaptive polling reacting to window-hidden state | #9 |
| Updater "Restart to update" tray menu item | #10 |

## Notes

- **Template icon.** macOS renders template icons in the system accent color; the asset must be black-on-transparent. The badge text alongside the icon is drawn by Tauri's `set_title`, which already inherits menu-bar styling.
- **Popover anchoring.** Tauri 2 doesn't ship a first-class NSPopover wrapper; positioning by `TrayIconEvent` position + `window.set_position` is the documented workaround. If the result feels off-center, the [tauri-plugin-positioner](https://github.com/tauri-apps/tauri-plugin-positioner) crate is the fallback — flag in PR.
- **State sharing.** The popover route and the main window are separate WebviewWindows but they both load the same Next.js bundle, so the Zustand store + TanStack Query cache live in each window independently. Cross-window sync happens through the Rust poller pushing a single `PollResultPayload` event that both windows subscribe to. Don't reach for cross-window IPC for incremental UI updates — let the poller be the single source of truth.
