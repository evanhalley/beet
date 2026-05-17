"use client";

import { useMemo } from "react";

import { useAppStore } from "@/lib/store";
import {
  AUTO_REQUEUE_MAX_ATTEMPTS_MAX,
  AUTO_REQUEUE_MAX_ATTEMPTS_MIN,
  parseLineList,
  setAutoRequeueEnabled,
  setAutoRequeueMaxAttempts,
  setAutoRequeueRepos,
} from "@/lib/storage/settings";
import { Field, H, Stack, inputClass, inputStyle } from "./atoms";

// `owner/repo` per line. Loose validation so common typos (extra slashes,
// trailing whitespace) are surfaced but not silently dropped.
const REPO_RE = /^[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+$/;

export function MergeQueueTab() {
  return (
    <Stack>
      <H>Merge Queue</H>
      <EnabledToggle />
      <MaxAttemptsField />
      <ReposField />
    </Stack>
  );
}

function EnabledToggle() {
  const value = useAppStore((s) => s.settings.autoRequeueEnabled);
  const setSettings = useAppStore((s) => s.setSettings);

  const onToggle = async (next: boolean) => {
    await setAutoRequeueEnabled(next);
    setSettings({ autoRequeueEnabled: next });
  };

  return (
    <Field
      label="Auto re-enqueue"
      hint="When one of your PRs gets kicked out of the merge queue by a failing check, Beet quietly re-enqueues it. All failures are treated as flaky — the retry cap is the only guardrail."
    >
      <label
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 8,
          fontSize: 12.5,
        }}
      >
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onToggle(e.target.checked)}
        />
        Re-enqueue PRs that fall out of the merge queue
      </label>
    </Field>
  );
}

function MaxAttemptsField() {
  const value = useAppStore((s) => s.settings.autoRequeueMaxAttempts);
  const setSettings = useAppStore((s) => s.setSettings);

  const onChange = (next: number) => {
    setSettings({ autoRequeueMaxAttempts: next });
  };

  const onCommit = async () => {
    await setAutoRequeueMaxAttempts(value);
  };

  return (
    <Field
      label="Max retry attempts per head SHA"
      hint={`Default 2. Once a PR's head SHA hits the cap, Beet stops retrying until a new push lands.`}
    >
      <input
        type="number"
        min={AUTO_REQUEUE_MAX_ATTEMPTS_MIN}
        max={AUTO_REQUEUE_MAX_ATTEMPTS_MAX}
        step={1}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        onBlur={onCommit}
        aria-label="Max retry attempts per head SHA"
        className={`${inputClass} mono`}
        style={{ ...inputStyle(true), width: 80 }}
      />
    </Field>
  );
}

function ReposField() {
  const repos = useAppStore((s) => s.settings.autoRequeueRepos);
  const setSettings = useAppStore((s) => s.setSettings);

  const onChange = (text: string) => {
    setSettings({ autoRequeueRepos: text.split("\n") });
  };

  const invalid = useMemo(
    () =>
      repos
        .map((r) => r.trim())
        .filter((r) => r && !REPO_RE.test(r)),
    [repos],
  );

  const onBlur = async () => {
    const parsed = parseLineList(repos.join("\n")).filter((r) =>
      REPO_RE.test(r),
    );
    await setAutoRequeueRepos(parsed);
    setSettings({ autoRequeueRepos: parsed });
  };

  return (
    <Field
      label="Restrict to repos"
      hint={`One \`owner/repo\` per line. Leave empty to allow auto-requeue across every repo where you author PRs.`}
    >
      <textarea
        value={repos.join("\n")}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="acme/widgets"
        rows={4}
        className={`${inputClass} mono`}
        style={inputStyle(true)}
      />
      {invalid.length > 0 && (
        <div
          className="mono mt-2"
          style={{ fontSize: 11, color: "var(--color-danger)" }}
        >
          ignored on save: {invalid.join(", ")}
        </div>
      )}
    </Field>
  );
}
