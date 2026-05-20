"use client";

import { usePollEvents } from "@/hooks/usePollEvents";
import { useTrayCommands } from "@/hooks/useTrayCommands";
import { TrayPopover } from "@/components/TrayPopover";

export default function TrayPage() {
  usePollEvents();
  useTrayCommands();
  return <TrayPopover />;
}
