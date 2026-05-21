"use client";

import { Pin, X } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { removeMute, removePin } from "@/lib/storage/mutePin";
import { H, Stack } from "./atoms";

export function MutePinTab() {
  const pins = useAppStore((s) => s.pins);
  const mutes = useAppStore((s) => s.mutes);
  const setPins = useAppStore((s) => s.setPins);
  const setMutes = useAppStore((s) => s.setMutes);

  const repoMutes = mutes.filter((m) => m.scope === "repo");
  const orgMutes = mutes.filter((m) => m.scope === "org");

  const isEmpty = pins.length === 0 && mutes.length === 0;

  return (
    <Stack>
      <H>Mute & Pin</H>

      {isEmpty && (
        <p style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>
          No rules yet. Right-click any row to mute a repo/org or pin a repo.
        </p>
      )}

      {pins.length > 0 && (
        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--color-text-muted)",
              marginBottom: 8,
            }}
          >
            Pinned repos
          </div>
          {pins.map((value) => (
            <RuleRow
              key={value}
              icon={<Pin size={12} style={{ color: "var(--color-accent)" }} />}
              label={value}
              onRemove={async () => {
                await removePin(value);
                setPins(pins.filter((p) => p !== value));
              }}
            />
          ))}
        </section>
      )}

      {repoMutes.length > 0 && (
        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--color-text-muted)",
              marginBottom: 8,
            }}
          >
            Muted repos
          </div>
          {repoMutes.map((rule) => (
            <RuleRow
              key={`repo:${rule.value}`}
              label={rule.value}
              onRemove={async () => {
                await removeMute("repo", rule.value);
                setMutes(
                  mutes.filter(
                    (m) => !(m.scope === "repo" && m.value === rule.value),
                  ),
                );
              }}
            />
          ))}
        </section>
      )}

      {orgMutes.length > 0 && (
        <section>
          <div
            style={{
              fontSize: 11,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.5px",
              color: "var(--color-text-muted)",
              marginBottom: 8,
            }}
          >
            Muted orgs
          </div>
          {orgMutes.map((rule) => (
            <RuleRow
              key={`org:${rule.value}`}
              label={rule.value}
              onRemove={async () => {
                await removeMute("org", rule.value);
                setMutes(
                  mutes.filter(
                    (m) => !(m.scope === "org" && m.value === rule.value),
                  ),
                );
              }}
            />
          ))}
        </section>
      )}
    </Stack>
  );
}

function RuleRow({
  icon,
  label,
  onRemove,
}: {
  icon?: React.ReactNode;
  label: string;
  onRemove: () => void;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "6px 0",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {icon}
      <span
        className="mono"
        style={{ flex: 1, fontSize: 12.5, color: "var(--color-text)" }}
      >
        {label}
      </span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label}`}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 20,
          height: 20,
          borderRadius: 4,
          background: "transparent",
          color: "var(--color-text-faint)",
          cursor: "pointer",
          border: "none",
        }}
      >
        <X size={12} />
      </button>
    </div>
  );
}
