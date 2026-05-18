import type { ActionableItem } from "@/lib/types";

const MAX_RESULTS = 50;

interface Hit {
  item: ActionableItem;
  pos: number;
  bucket: 0 | 1;
}

function taskIdFromUrl(url: string): string {
  const trimmed = url.replace(/\/+$/, "");
  const tail = trimmed.split("/").pop() ?? "";
  return tail.split("?")[0];
}

function buildHaystack(item: ActionableItem): string {
  const parts: string[] = [item.title, item.repoFullName];
  if (item.pr) {
    parts.push(String(item.pr.number), `#${item.pr.number}`, item.pr.author);
    for (const url of item.pr.taskUrls) {
      const id = taskIdFromUrl(url);
      if (id) parts.push(id);
    }
  }
  return parts.join(" ").toLowerCase();
}

function buildInitials(item: ActionableItem): string {
  return item.title
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join("")
    .toLowerCase();
}

export function matchItems(
  query: string,
  items: ActionableItem[],
): ActionableItem[] {
  const q = query.trim().toLowerCase();
  if (q === "") return [];

  const hits: Hit[] = [];
  for (const item of items) {
    const pos = buildHaystack(item).indexOf(q);
    if (pos >= 0) {
      hits.push({ item, pos, bucket: 0 });
      continue;
    }
    const initialsPos = buildInitials(item).indexOf(q);
    if (initialsPos >= 0) {
      hits.push({ item, pos: initialsPos, bucket: 1 });
    }
  }

  hits.sort((a, b) => {
    if (a.bucket !== b.bucket) return a.bucket - b.bucket;
    if (a.pos !== b.pos) return a.pos - b.pos;
    if (a.item.updatedAt > b.item.updatedAt) return -1;
    if (a.item.updatedAt < b.item.updatedAt) return 1;
    return 0;
  });

  return hits.slice(0, MAX_RESULTS).map((h) => h.item);
}
