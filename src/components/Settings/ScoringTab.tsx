"use client";

import { useMemo } from "react";
import { useAppStore } from "@/lib/store";
import { compileTaskRegex, extractTaskUrls } from "@/lib/tasks";
import {
  parseLineList,
  setPenalizedBots,
  setShowAllApproved,
  setTaskRegex,
} from "@/lib/storage/settings";
import { Field, H, Stack, inputClass, inputStyle } from "./atoms";

const WEIGHTS: Array<{ rule: string; delta: string }> = [
  { rule: "Author on a team I'm in", delta: "+6" },
  { rule: "I'm a requested reviewer", delta: "+3" },
  { rule: "I've commented", delta: "+2" },
  { rule: "I've reviewed", delta: "+2" },
  { rule: "I've approved", delta: "−100" },
  { rule: "additions > 250", delta: "−1" },
  { rule: "deletions > 250", delta: "−1" },
  { rule: "not updated in > 10 days", delta: "−1" },
  { rule: "created > 60d AND not updated in > 60d (stale)", delta: "= 0" },
  { rule: "Draft", delta: "−5" },
  { rule: "Author in penalized bots list", delta: "= −10" },
];

const SAMPLE_BODY =
  "See https://your-company.atlassian.net/browse/PROJ-123 and PROJ-456 in body.";

export function ScoringTab() {
  return (
    <Stack>
      <H>Scoring</H>
      <WeightsTable />
      <PenalizedBotsField />
      <TaskRegexField />
      <ShowApprovedField />
    </Stack>
  );
}

function WeightsTable() {
  return (
    <Field label="Weights" hint="Read-only in V1. Score = sum of matching rules.">
      <div
        style={{
          borderRadius: 8,
          border: "1px solid var(--color-border)",
          background: "var(--color-panel)",
          overflow: "hidden",
        }}
      >
        {WEIGHTS.map((row, idx) => (
          <div
            key={row.rule}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "7px 12px",
              fontSize: 12.5,
              borderTop: idx === 0 ? "none" : "1px solid var(--color-border)",
            }}
          >
            <span style={{ color: "var(--color-text)" }}>{row.rule}</span>
            <span
              className="mono"
              style={{ color: "var(--color-text-muted)", fontWeight: 500 }}
            >
              {row.delta}
            </span>
          </div>
        ))}
      </div>
    </Field>
  );
}

function PenalizedBotsField() {
  const bots = useAppStore((s) => s.settings.penalizedBots);
  const setSettings = useAppStore((s) => s.setSettings);

  const onChange = (value: string) => {
    setSettings({ penalizedBots: value.split("\n") });
  };

  const onBlur = async () => {
    const parsed = parseLineList(bots.join("\n"));
    await setPenalizedBots(parsed);
    setSettings({ penalizedBots: parsed });
  };

  return (
    <Field
      label="Penalized bots"
      hint="GitHub login per line. PRs from these authors get a hard −10 (overwrites other rules)."
    >
      <textarea
        value={bots.join("\n")}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="renovate[bot]"
        rows={3}
        className={`${inputClass} mono`}
        style={inputStyle(true)}
      />
    </Field>
  );
}

function TaskRegexField() {
  const taskRegex = useAppStore((s) => s.settings.taskRegex);
  const setSettings = useAppStore((s) => s.setSettings);

  const preview = useMemo(() => {
    const compiled = compileTaskRegex(taskRegex);
    if (!compiled) return { ok: false, matches: [] as string[] };
    return { ok: true, matches: extractTaskUrls(SAMPLE_BODY, compiled) };
  }, [taskRegex]);

  const onChange = (value: string) => {
    setSettings({ taskRegex: value });
  };

  const onBlur = async () => {
    await setTaskRegex(taskRegex);
  };

  return (
    <Field
      label="Task URL regex"
      hint="Matches in PR bodies become chips. Raw pattern or /pattern/flags."
    >
      <input
        type="text"
        value={taskRegex}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={`${inputClass} mono`}
        style={inputStyle(true)}
      />
      <div
        className="mono mt-2"
        style={{ fontSize: 11, color: "var(--color-text-faint)" }}
      >
        {preview.ok ? (
          preview.matches.length > 0 ? (
            <>matches: {preview.matches.join(", ")}</>
          ) : (
            <>compiles, no matches against sample.</>
          )
        ) : (
          <span style={{ color: "var(--color-danger)" }}>invalid pattern</span>
        )}
      </div>
    </Field>
  );
}

function ShowApprovedField() {
  const value = useAppStore((s) => s.settings.showAllApproved);
  const setSettings = useAppStore((s) => s.setSettings);
  const setShowAllReviews = useAppStore((s) => s.setShowAllReviews);

  const onToggle = async (next: boolean) => {
    await setShowAllApproved(next);
    setSettings({ showAllApproved: next });
    setShowAllReviews(next);
  };

  return (
    <Field
      label="Show approved PRs"
      hint="Default state of the Show All toggle in Review Requests."
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
        Surface PRs I&apos;ve already approved
      </label>
    </Field>
  );
}
