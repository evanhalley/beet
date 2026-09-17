# Branch name in list rows + detail pane, with quick copy

**Refs:** §5 (ActionableItem model) · `design/src/main-window.jsx` (row author line, detail header)

## Goal

PR rows and the PR detail pane don't show the head branch. The detail pane still renders a literal `branch` placeholder, and the Rust `GitRef` model drops `head.ref` even though the `pulls/{num}` response already carries it.

Show the branch name everywhere an item is listed and in the detail pane, and make it copyable to the clipboard in one click.

## Scope

- **Data:** add `headRef` to the PR half of `ActionableItem`, sourced from `pull.head.ref` (no extra API call). Include it in the search index.
- **Main-window rows:** PR rows show the branch on the author line (matches the mockup). PR and standalone-run rows get a git-branch icon button in the top-right overlay, next to copy-link.
- **Tray rows:** review, in-flight, and run rows show the branch on the meta line with the same copy icon. Clicking copy must not open the item in the browser.
- **Detail pane:** PR header shows the branch in place of the placeholder. PR and run detail headers show the branch with the same copy icon beside it.
- **Fork PRs:** the bare branch name doesn't exist upstream (and is often `main`), so fork PRs show `owner:branch` and the copy button copies `gh pr checkout <number>`.
- Copy feedback matches the existing copy-link buttons (green check for 1.5 s). Reuses `copyToClipboard`; no new plugin or capability.

## Acceptance

- Branch visible in main-window rows, tray rows, and both detail views when known; nothing rendered when absent.
- Copy button writes the branch to the clipboard and never triggers row selection or browser open.
- Unit tests cover rendering, absence, and copy behavior; Rust tests cover `head.ref` parsing with and without the field.
