"use client";

import { useMemo, useState } from "react";
import { useAppStore } from "@/lib/store";
import { setStandaloneRunsAllowlist } from "@/lib/storage/settings";
import { Field, H, Stack, inputClass, inputStyle } from "./atoms";

// Roughly `owner/repo` — letters/digits/dash/underscore/dot, exactly one slash.
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

/// Format the allowlist as one line per repo:
/// `owner/repo: workflowA, workflowB`. Sorted alphabetically by repo so the
/// textarea content is stable across edits.
export function formatAllowlist(allowlist: Record<string, string[]>): string {
  return Object.keys(allowlist)
    .sort()
    .map((repo) => {
      const workflows = (allowlist[repo] ?? [])
        .map((w) => w.trim())
        .filter(Boolean);
      return workflows.length > 0
        ? `${repo}: ${workflows.join(", ")}`
        : `${repo}:`;
    })
    .join("\n");
}

interface ParseResult {
  allowlist: Record<string, string[]>;
  invalid: string[]; // lines we dropped (bad repo shape, missing colon)
}

/// Parse the textarea contents. Each non-blank line must look like
/// `owner/repo: workflowA, workflowB`. Empty workflow lists are preserved
/// (the Rust side treats them as "no filter for this repo").
export function parseAllowlist(text: string): ParseResult {
  const allowlist: Record<string, string[]> = {};
  const invalid: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const colon = line.indexOf(":");
    if (colon === -1) {
      invalid.push(line);
      continue;
    }
    const repo = line.slice(0, colon).trim();
    if (!REPO_RE.test(repo)) {
      invalid.push(line);
      continue;
    }
    const workflows = line
      .slice(colon + 1)
      .split(",")
      .map((w) => w.trim())
      .filter(Boolean);
    allowlist[repo] = workflows;
  }
  return { allowlist, invalid };
}

export function RunsTab() {
  return (
    <Stack>
      <H>Standalone Runs</H>
      <AllowlistField />
    </Stack>
  );
}

function AllowlistField() {
  const stored = useAppStore((s) => s.settings.standaloneRunsAllowlist);
  const setSettings = useAppStore((s) => s.setSettings);
  // Local draft so the user can edit mid-line without each keystroke
  // round-tripping through the formatter and re-sorting.
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? formatAllowlist(stored);

  const invalid = useMemo(() => parseAllowlist(text).invalid, [text]);

  const onBlur = async () => {
    const parsed = parseAllowlist(text);
    await setStandaloneRunsAllowlist(parsed.allowlist);
    setSettings({ standaloneRunsAllowlist: parsed.allowlist });
    setDraft(null);
  };

  return (
    <Field
      label="Workflow allowlist"
      hint="One line per repo: `owner/repo: WorkflowA, WorkflowB`. Repos not listed show every workflow (still deduped to the most-recent run per workflow). Leave the list empty to keep a repo in pass-through mode."
    >
      <textarea
        value={text}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={onBlur}
        placeholder="acme/web-app: Deploy, Release"
        rows={6}
        className={`${inputClass} mono`}
        style={inputStyle(true)}
      />
      {invalid.length > 0 && (
        <div
          className="mono mt-2"
          style={{ fontSize: 11, color: "var(--color-danger)" }}
        >
          ignored on save: {invalid.join(" · ")}
        </div>
      )}
    </Field>
  );
}
