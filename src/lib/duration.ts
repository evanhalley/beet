/**
 * Format a duration in seconds as a compact, human-readable string.
 * `< 60s` → `Xs`, `< 1h` → `Xm Ys`, `>= 1h` → `Xh Ym`.
 *
 * Returns `null` when the input is not a finite non-negative number, so
 * callers can branch on absence (e.g. "—" placeholder) rather than rendering
 * "NaN" or "-3s".
 */
export function formatDuration(seconds: number): string | null {
  if (!Number.isFinite(seconds) || seconds < 0) return null;
  const total = Math.floor(seconds);
  if (total < 60) return `${total}s`;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours === 0) {
    return secs === 0 ? `${minutes}m` : `${minutes}m ${secs}s`;
  }
  return minutes === 0 ? `${hours}h` : `${hours}h ${minutes}m`;
}

/**
 * Wall-clock seconds between two ISO timestamps. Returns `null` if either
 * input is missing/unparseable or the result is negative (clock skew).
 */
export function durationSeconds(
  start: string | null | undefined,
  end: string | null | undefined,
): number | null {
  if (!start || !end) return null;
  const s = Date.parse(start);
  const e = Date.parse(end);
  if (Number.isNaN(s) || Number.isNaN(e)) return null;
  const diff = (e - s) / 1000;
  return diff >= 0 ? diff : null;
}
