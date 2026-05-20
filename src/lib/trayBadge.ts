export function formatBadge(count: number, paused: boolean): string {
  if (count === 0 && !paused) return "";
  if (count === 0 && paused) return "⏸";
  if (!paused) return String(count);
  return `⏸ ${count}`;
}
