# Beet design mockups

Static, browser-rendered mockups of Beet's two surfaces (tray popover, main
window) and Settings. Used to align on UX before scaffolding the real Tauri
app. Source of truth for behavior is still [../SPECS.md](../SPECS.md).

## Run it

```
./serve.sh           # http://localhost:8000/Beet.html
./serve.sh 8080      # custom port
```

`serve.sh` runs `python3 -m http.server` bound to `127.0.0.1`. No deps. The
`file://` protocol won't work — Babel-standalone fetches the `.jsx` files at
runtime and the browser blocks cross-origin reads from disk.

## Structure

- [Beet.html](Beet.html) — entry point. Loads React, ReactDOM, and Babel from
  unpkg, then `<script type="text/babel">`-includes everything in `src/` in
  dependency order.
- [src/design-canvas.jsx](src/design-canvas.jsx) — Figma-ish pan/zoom canvas
  with artboards. Persists arrangement to a sidecar JSON when run inside the
  authoring host.
- [src/tweaks-panel.jsx](src/tweaks-panel.jsx) — runtime knobs for theme,
  accent, density, and `updateReady`.
- [src/data.jsx](src/data.jsx) — `MOCK` and `PR_DETAIL` fixtures. Generic
  placeholder names; mirrors the `ActionableItem` shape from §5.
- [src/ui.jsx](src/ui.jsx) — shared primitives: `BeetMark`, `Pill`, `CheckDot`,
  `Avatar`, `ScoreBar`, `ReasonBadge`, `Lifecycle`, `RunStatus`, `TaskChips`,
  `PinGlyph`, plus the inline-SVG icon set `I.*`.
- [src/tray.jsx](src/tray.jsx) — 360 × 480 menu-bar popover. Two visual
  variants (`v1`, `v2`).
- [src/main-window.jsx](src/main-window.jsx) — three-pane main window. Two
  layout variants: classic sidebar/list/detail (`v1`) and lanes (`v2`).
- [src/settings.jsx](src/settings.jsx) — six-tab settings panel.
- [src/styles.css](src/styles.css) — design tokens (colors, shadows, fonts) +
  light/dark theming via `[data-theme]`.
- [beet-mark.svg](beet-mark.svg) — standalone export of the brand mark.

## Authoring notes

- React 18 UMD + Babel-standalone — no build step. Edits hot-reload on
  refresh.
- Mock data lives in `MOCK`. Add a row to a section by editing
  [src/data.jsx](src/data.jsx); rows render via the corresponding row
  component in `tray.jsx` / `main-window.jsx`.
- New shared primitives go in [src/ui.jsx](src/ui.jsx) and must be assigned
  onto `window` at the bottom (`Object.assign(window, { … })`) so other files
  can use them without imports.
- Component file load order matters: see the `<script>` tags in
  [Beet.html](Beet.html). `data.jsx` and `ui.jsx` must load before any file
  that consumes them.
