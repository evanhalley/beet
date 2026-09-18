import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vitest";

// `:root { zoom: var(--font-scale) }` (globals.css) doesn't rescale viewport
// units in WebKit, so a `100vh` / `h-screen` shell renders --font-scale × the
// window height and `body { overflow: hidden }` clips its bottom edge — panes
// can't scroll to their last rows. Size shells with `h-full` off the 100%
// html → body chain instead. jsdom has no layout, so guard the source.
const SRC = join(__dirname, "..", "..");
const FORBIDDEN = /\b(?:min-|max-)?[hw]-screen\b|\b\d+(?:\.\d+)?d?v[hw]\b/;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

test("app shells size to the window with h-full, not viewport units", () => {
  // SearchPalette's padding/max-height are proportional offsets inside an
  // already-fitted overlay, not a window-height shell, so they're allowed.
  const allowed = new Set(["components/SearchPalette.tsx"]);
  const offenders = sourceFiles(SRC)
    .filter((p) => !allowed.has(relative(SRC, p)))
    .flatMap((p) =>
      readFileSync(p, "utf8")
        .split("\n")
        .map((line, i) => ({ line, at: `${relative(SRC, p)}:${i + 1}` }))
        .filter(({ line }) => FORBIDDEN.test(line))
        .map(({ at, line }) => `${at}  ${line.trim()}`),
    );
  expect(offenders).toEqual([]);
});
