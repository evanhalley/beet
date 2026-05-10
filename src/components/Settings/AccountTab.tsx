"use client";

import { useEffect, useMemo, useState } from "react";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import { useAuth } from "@/hooks/useAuth";
import { REQUIRED_SCOPES } from "@/lib/github/auth";
import { ScopesGrid, type ScopeStatus } from "./ScopesGrid";
import {
  Field,
  H,
  Pill,
  Stack,
  btnStyle,
  inputClass,
  inputStyle,
} from "./atoms";

dayjs.extend(relativeTime);

const TOKEN_PLACEHOLDER = "ghp_••••••••••••••••••••••••••••••••••••";

export function AccountTab() {
  const { auth, token, lastCheckedAt, saveToken, revalidate, isLoading } = useAuth();
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lastCheckedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [lastCheckedAt]);

  const scopes: ScopeStatus[] = useMemo(
    () =>
      REQUIRED_SCOPES.map((name) => ({
        name,
        status: auth?.scopes.includes(name) ? "ok" : "missing",
      })),
    [auth],
  );

  const lastCheckedLabel = lastCheckedAt ? dayjs(lastCheckedAt).from(now) : null;

  const onValidate = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== token) {
      await saveToken(trimmed);
      setDraft("");
    } else {
      revalidate();
    }
  };

  const validateDisabled = isLoading || (draft.trim().length === 0 && !token);

  return (
    <Stack>
      <H>Account</H>

      <Field
        label="GitHub username"
        hint="Auto-detected from token."
      >
        <input
          type="text"
          readOnly
          value={auth?.login ?? ""}
          placeholder="—"
          className={inputClass}
          style={inputStyle()}
        />
      </Field>

      <Field
        label="Personal access token"
        hint="Stored locally via Tauri Store. Never sent anywhere except api.github.com."
      >
        <div className="flex gap-2">
          <input
            type="password"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={token ? TOKEN_PLACEHOLDER : "ghp_..."}
            aria-label="Personal access token"
            className={`${inputClass} mono`}
            style={inputStyle(true)}
          />
          <button
            type="button"
            onClick={onValidate}
            disabled={validateDisabled}
            className="disabled:opacity-50"
            style={btnStyle()}
          >
            Validate
          </button>
        </div>
        {auth && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {auth.ok ? (
              <Pill tone="success" soft>
                ● valid{auth.login ? ` as ${auth.login}` : ""}
              </Pill>
            ) : auth.error === "no_token" ? null : (
              <Pill tone="warn" soft>
                ● {auth.error === "invalid" ? "rejected" : "network error"}
              </Pill>
            )}
            {lastCheckedLabel && (
              <span style={{ fontSize: 11, color: "var(--color-text-muted)" }}>
                Last checked {lastCheckedLabel}.
              </span>
            )}
          </div>
        )}
      </Field>

      <Field label="Required scopes">
        <ScopesGrid scopes={scopes} />
      </Field>

      <Field
        label="Teams to track"
        hint="Lands in #3 — used for PR-author team detection in the priority score."
      >
        <input
          type="text"
          disabled
          placeholder="acme/team-name"
          className={`${inputClass} mono cursor-not-allowed opacity-60`}
          style={{
            ...inputStyle(true),
            color: "var(--color-text-muted)",
          }}
        />
      </Field>
    </Stack>
  );
}
