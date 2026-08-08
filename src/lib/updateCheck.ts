// Lightweight update check against the public GitHub Releases feed. Interim
// substitute until the signed tauri-plugin-updater lands (issue #27): no
// download, no install — just "a newer version exists, here's the page".

export interface UpdateCheckResult {
  latest: string;
  url: string;
  updateAvailable: boolean;
}

/** Strip common tag prefixes: "v0.1.6" / "app-v0.1.6" / "0.1.6" → "0.1.6". */
export function parseTagVersion(tag: string): string {
  return tag.replace(/^(app-)?v/, "");
}

/** Numeric segment-wise compare; "0.10.0" beats "0.9.9". */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = latest.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const b = current.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return false;
}

export async function checkForUpdate(
  currentVersion: string,
): Promise<UpdateCheckResult> {
  const res = await fetch(
    "https://api.github.com/repos/evanhalley/beet/releases/latest",
    { headers: { Accept: "application/vnd.github+json" } },
  );
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
  const json = (await res.json()) as { tag_name?: string; html_url?: string };
  const latest = parseTagVersion(json.tag_name ?? "");
  return {
    latest,
    url: json.html_url ?? "https://github.com/evanhalley/beet/releases",
    updateAvailable: isNewerVersion(latest, currentVersion),
  };
}
