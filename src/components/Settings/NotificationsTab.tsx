"use client";

import { useAppStore } from "@/lib/store";
import {
  setNotifyOnEjection,
  setNotifyOnFailingChecks,
  setNotifyOnReviewRequest,
  setNotifyOnMention,
  setNotifyOnRunFinished,
} from "@/lib/storage/settings";
import { Field, H, Stack } from "./atoms";

interface ToggleRowProps {
  label: string;
  hint: string;
  value: boolean;
  onChange: (v: boolean) => void;
}

function ToggleRow({ label, hint, value, onChange }: ToggleRowProps) {
  return (
    <Field label={label} hint={hint}>
      <label
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          cursor: "pointer",
          userSelect: "none",
        }}
      >
        <input
          type="checkbox"
          checked={value}
          onChange={(e) => onChange(e.target.checked)}
          style={{ width: 16, height: 16, accentColor: "var(--color-accent)" }}
        />
        <span style={{ fontSize: 12.5, color: "var(--color-text)" }}>
          {value ? "On" : "Off"}
        </span>
      </label>
    </Field>
  );
}

export function NotificationsTab() {
  const settings = useAppStore((s) => s.settings);
  const setSettings = useAppStore((s) => s.setSettings);

  return (
    <Stack>
      <H>Notifications</H>
      <ToggleRow
        label="Merge-queue ejection"
        hint="Fire when one of your PRs is kicked from the merge queue."
        value={settings.notifyOnEjection}
        onChange={async (v) => {
          setSettings({ notifyOnEjection: v });
          await setNotifyOnEjection(v);
        }}
      />
      <ToggleRow
        label="Failing checks on your PR"
        hint="Fire when a CI check transitions to failure on a PR you authored."
        value={settings.notifyOnFailingChecks}
        onChange={async (v) => {
          setSettings({ notifyOnFailingChecks: v });
          await setNotifyOnFailingChecks(v);
        }}
      />
      <ToggleRow
        label="New review request"
        hint="Fire when a new PR review is requested from you."
        value={settings.notifyOnReviewRequest}
        onChange={async (v) => {
          setSettings({ notifyOnReviewRequest: v });
          await setNotifyOnReviewRequest(v);
        }}
      />
      <ToggleRow
        label="Comment / @mention"
        hint="Fire when someone mentions you or replies to your review."
        value={settings.notifyOnMention}
        onChange={async (v) => {
          setSettings({ notifyOnMention: v });
          await setNotifyOnMention(v);
        }}
      />
      <ToggleRow
        label="Workflow run finished"
        hint="Fire when a standalone workflow run you triggered completes."
        value={settings.notifyOnRunFinished}
        onChange={async (v) => {
          setSettings({ notifyOnRunFinished: v });
          await setNotifyOnRunFinished(v);
        }}
      />
    </Stack>
  );
}
