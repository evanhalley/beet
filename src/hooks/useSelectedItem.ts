"use client";

import { useAppStore } from "@/lib/store";
import { useActionableItems } from "@/hooks/useActionableItems";
import type { ActionableItem } from "@/lib/types";

// Resolves the store's selectedItemId against the live React Query data.
// Returns null when nothing is selected or the id no longer resolves (a
// "ghost" selection — e.g. the item dropped out of every section).
export function useSelectedItem(): ActionableItem | null {
  const selectedItemId = useAppStore((s) => s.selectedItemId);
  const { byId } = useActionableItems();
  if (!selectedItemId) return null;
  return byId.get(selectedItemId) ?? null;
}
