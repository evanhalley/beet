"use client";

import { usePollEvents } from "@/hooks/usePollEvents";
import { useTrayCommands } from "@/hooks/useTrayCommands";
import { useThemeSync } from "@/hooks/useThemeSync";
import { TrayPopover } from "@/components/TrayPopover";

export default function TrayPage() {
  usePollEvents({ pokeOnMount: false });
  useTrayCommands();
  useThemeSync();
  return (
    <div style={{ width: "100%", height: "100%", overflow: "hidden" }}>
      <TrayPopover />
    </div>
  );
}
