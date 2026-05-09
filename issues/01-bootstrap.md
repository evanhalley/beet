# #1 — Bootstrap

Stand up the empty Beet shell: Tauri 2 + Next.js (static export) + React 19 + Tailwind 4 + Vitest. No GitHub data, no PAT, no SQL, no popover — just a window that opens, a tray icon that's there, and a passing smoke test. Every later iteration sits on this scaffold.

Refs: [SPECS.md §3](../SPECS.md) (locked stack), [§13](../SPECS.md) (macOS-only), [§16](../SPECS.md) (acceptance — this issue covers the build/test/lint half).

## Goal

The simplest possible Beet that builds, runs, and tests cleanly.

## Acceptance criteria

- [ ] `npm install` from a fresh clone completes without errors.
- [ ] `npm run tauri dev` boots Next.js + Tauri and opens a single window titled **Beet** showing the beet mark and the heading "Beet 🫜".
- [ ] Tray icon is visible in the macOS menu bar; the menu has **Open Beet** and **Quit**.
- [ ] **Quit** exits the process; **Open Beet** focuses the main window.
- [ ] Launching a second instance focuses the first window — no duplicate window opens (`tauri-plugin-single-instance`).
- [ ] `npx vitest` runs and the smoke test passes.
- [ ] `npm run lint` passes with zero warnings.
- [ ] `npm run tauri build` produces a `.app` in `src-tauri/target/release/bundle/macos/` and the app launches when double-clicked.
- [ ] **CI workflow** at `.github/workflows/ci.yml` runs on every pull-request push and every push to `main`. It installs deps, lints, runs `vitest`, builds the Next.js bundle, and compiles the Tauri Rust binary. CI is green on the bootstrap PR before merge.

## File layout

Mirrors [PRZ's structure](file:///Users/evan/dev/prz) with the additional directories §14 of the spec calls for. New files only — nothing inherited yet.

```
beet/
├── .github/
│   └── workflows/
│       └── ci.yml                     ← lint + test + frontend build + cargo build
├── package.json
├── tsconfig.json
├── next.config.ts
├── next-env.d.ts
├── postcss.config.mjs
├── eslint.config.mjs
├── vitest.config.ts
├── .gitignore
├── public/
│   └── beet-mark.svg                  ← lifted from design/beet-mark.svg
├── src/
│   ├── app/
│   │   ├── layout.tsx
│   │   ├── page.tsx                   ← renders "Beet 🫜"
│   │   └── globals.css                ← Tailwind 4 directives
│   └── test/
│       ├── setup.ts                   ← jsdom + RTL config
│       └── page.test.tsx              ← smoke test
└── src-tauri/
    ├── Cargo.toml
    ├── build.rs
    ├── tauri.conf.json
    ├── capabilities/default.json
    ├── icons/                         ← placeholder set; replace in #9
    └── src/
        ├── main.rs
        └── lib.rs                     ← tray + single-instance setup
```

## Dependencies

Match PRZ's locked versions where they apply, so the two projects are easy to keep in sync.

**Frontend (`package.json`)**

```jsonc
{
  "dependencies": {
    "next": "16.1.6",
    "react": "19.2.3",
    "react-dom": "19.2.3",
    "@tauri-apps/api": "^2.10.1",
    "@tauri-apps/plugin-shell": "^2.3.5",
    "lucide-react": "^0.575.0"
  },
  "devDependencies": {
    "@tauri-apps/cli": "^2.10.0",
    "@tailwindcss/postcss": "^4",
    "tailwindcss": "^4",
    "typescript": "^5",
    "vitest": "^4.0.18",
    "@vitest/coverage-v8": "^4.0.18",
    "@testing-library/react": "^16",
    "@testing-library/jest-dom": "^6",
    "jsdom": "^25",
    "eslint": "^9",
    "eslint-config-next": "16.1.6",
    "babel-plugin-react-compiler": "1.0.0",
    "@types/react": "^19",
    "@types/react-dom": "^19",
    "@types/node": "^20"
  }
}
```

Scripts:

```jsonc
{
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "tauri": "tauri",
    "test": "vitest run"
  }
}
```

**Rust (`src-tauri/Cargo.toml`)**

```toml
[dependencies]
tauri = { version = "2", features = ["tray-icon"] }
tauri-plugin-shell = "2"
tauri-plugin-single-instance = "2"
serde = { version = "1", features = ["derive"] }
serde_json = "1"
```

Plugins deferred (added in their owning iteration): `tauri-plugin-store` (#2), `tauri-plugin-sql` (#2), `tauri-plugin-notification` (#8), `tauri-plugin-updater` (#9), `tauri-plugin-autostart` (#9).

## Configuration details

- **`tauri.conf.json`**: `productName: "Beet"`, `identifier: "dev.evanhalley.beet"`, `frontendDist: "../out"`, `devUrl: "http://localhost:3000"`. One window: title `Beet`, 800 × 600, resizable, not fullscreen. Bundle targets `["app", "dmg"]` (macOS only). `csp: null` for now.
- **`next.config.ts`**: `output: "export"`, `images: { unoptimized: true }`. Tauri serves the static bundle.
- **`vitest.config.ts`**: jsdom environment, setup file at `src/test/setup.ts`, `globals: true`, exclude `src-tauri/**` and `node_modules`.
- **`eslint.config.mjs`**: extend `next/core-web-vitals` and `next/typescript`. Match PRZ's flat-config shape.
- **Icons**: copy PRZ's [src-tauri/icons](file:///Users/evan/dev/prz/src-tauri/icons) as placeholders for now. Beet-branded icons land in #9.

## What `lib.rs` should do

1. Initialize `tauri-plugin-single-instance` with a callback that focuses the existing main window when a second instance starts.
2. Build the tray icon (`tauri::tray::TrayIconBuilder`) with a menu containing **Open Beet** (focus the window) and **Quit** (`app.exit(0)`).
3. Register `tauri-plugin-shell`.

Window-close behavior in #1 is the OS default (closing the window may quit on macOS). Window-close-≠-quit is wired in #6.

## What `page.tsx` should render

A single centered card with the beet mark SVG and the text "Beet 🫜". Tailwind for layout. No client-side state, no Octokit, no fetches. This is the visual smoke test.

## Test plan

**Unit smoke test** — `src/test/page.test.tsx`:

```tsx
import { render, screen } from "@testing-library/react";
import Page from "@/app/page";

test("renders the Beet heading", () => {
  render(<Page />);
  expect(screen.getByRole("heading", { name: /beet/i })).toBeInTheDocument();
});
```

**Manual checks (macOS)**:
- Launch via `npm run tauri dev`, confirm window + tray.
- Right-click tray → **Quit** exits.
- `open -n /path/to/Beet.app` twice → second invocation focuses the first window, no second window appears.
- `npm run tauri build` produces a runnable `.app`.

## Continuous integration

`.github/workflows/ci.yml` — single job, `macos-latest` (we're macOS-only per §13, and Tauri's Rust build can't cross-compile cleanly anyway). Triggers on every PR push and on pushes to `main`.

```yaml
name: CI

on:
  pull_request:
  push:
    branches: [main]

concurrency:
  group: ci-${{ github.ref }}
  cancel-in-progress: true

jobs:
  build:
    runs-on: macos-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'npm'

      - uses: dtolnay/rust-toolchain@stable
        with:
          components: clippy

      - uses: Swatinem/rust-cache@v2
        with:
          workspaces: src-tauri -> target

      - run: npm ci

      - run: npm run lint
      - run: npm test
      - run: npm run build                           # Next.js static export → out/

      - run: cargo build --manifest-path src-tauri/Cargo.toml --locked
      - run: cargo clippy --manifest-path src-tauri/Cargo.toml --locked -- -D warnings
```

**Notes:**

- Debug `cargo build`, not `tauri build`. The full bundle/sign flow lands in #9 with the release workflow; CI just needs to prove the Rust half compiles.
- `concurrency` block kills in-flight runs when a new commit lands on the same ref — keeps the queue short on rapid pushes.
- `Swatinem/rust-cache` is the de-facto cache for Cargo registry + `target/` and saves several minutes per run.
- `clippy -D warnings` keeps Rust-side lint enforced from day one. Mirror of how `eslint` enforces JS-side.
- No Linux/Windows matrix (§13). When V2 expands platforms, add them as parallel jobs here.

## Out of scope (deferred)

| Concern | Lands in |
|---|---|
| PAT field, Octokit, scope check | #2 |
| SQLite migration, ETag cache | #2 |
| Polling, TanStack Query, Zustand | #3 |
| Section rendering, scoring | #3 |
| Workflow runs | #5 |
| Tray popover UI, window-close-≠-quit | #6 |
| OS notifications | #8 |
| Auto-update + autostart, final icon set | #9 |

## Notes

- Don't lift any code from PRZ or Action Jackson in this issue. The point is to land a clean shell. Migration starts in #2.
- Don't add Settings or any nav structure — that complicates the smoke test and gets reworked in #2 when the Settings panel arrives.
- If the React Compiler plugin causes friction, leave the dep in `package.json` but skip wiring it into Babel; it's there to keep version parity with PRZ and can be enabled in a later issue.
