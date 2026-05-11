"use client";

import { useEffect, useState } from "react";

import dayjs from "dayjs";
import { useAppStore } from "@/lib/store";
import { setPollingIntervalSec } from "@/lib/storage/settings";
import { Field, H, Stack, inputClass, inputStyle } from "./atoms";

const MIN = 15;
const MAX = 600;
const STEP = 15;

export function PollingTab() {
  return (
    <Stack>
      <H>Polling</H>
      <IntervalSlider />
      <RateLimitDisplay />
    </Stack>
  );
}

function IntervalSlider() {
  const value = useAppStore((s) => s.settings.pollingIntervalSec);
  const setSettings = useAppStore((s) => s.setSettings);

  const onChange = (next: number) => {
    setSettings({ pollingIntervalSec: next });
  };

  const onCommit = async () => {
    await setPollingIntervalSec(value);
  };

  return (
    <Field
      label="Polling interval"
      hint={`Review-request query refetches every ${value}s. Default 60s.`}
    >
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={MIN}
          max={MAX}
          step={STEP}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onMouseUp={onCommit}
          onKeyUp={onCommit}
          onTouchEnd={onCommit}
          aria-label="Polling interval seconds"
          className="flex-1"
        />
        <input
          type="number"
          min={MIN}
          max={MAX}
          step={STEP}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          onBlur={onCommit}
          aria-label="Polling interval seconds (number)"
          className={`${inputClass} mono`}
          style={{ ...inputStyle(true), width: 80 }}
        />
        <span style={{ fontSize: 11.5, color: "var(--color-text-muted)" }}>
          seconds
        </span>
      </div>
    </Field>
  );
}

function RateLimitDisplay() {
  const rateLimit = useAppStore((s) => s.rateLimit);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!rateLimit) return;
    const id = window.setInterval(
      () => setNow(Math.floor(Date.now() / 1000)),
      1000,
    );
    return () => window.clearInterval(id);
  }, [rateLimit]);

  if (!rateLimit) {
    return (
      <Field
        label="Rate limit"
        hint="Populated once a GitHub request has been made."
      >
        <div className="mono" style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>
          —
        </div>
      </Field>
    );
  }

  const resetIn = Math.max(0, rateLimit.reset - now);
  const resetLabel =
    resetIn > 0 ? dayjs.unix(rateLimit.reset).fromNow(true) : "now";

  return (
    <Field label="Rate limit" hint={`Resets in ${resetLabel}.`}>
      <div
        className="mono"
        style={{ fontSize: 14, color: "var(--color-text)", fontWeight: 600 }}
      >
        {rateLimit.remaining}
      </div>
    </Field>
  );
}
