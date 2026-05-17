"use client";

import { useEffect, useMemo, useState } from "react";
import dayjs from "@/lib/dayjs";
import { useAuth } from "@/hooks/useAuth";
import { REQUIRED_SCOPES } from "@/lib/github/auth";
import { useAppStore } from "@/lib/store";
import { parseLineList, setTeams } from "@/lib/storage/settings";
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

const TOKEN_PLACEHOLDER = "ghp_••••••••••••••••••••••••••••••••••••";

export function AccountTab() {
  const { auth, token, lastCheckedAt, validateAndSave, revalidate, isLoading, lastValidation } =
    useAuth();
  const [draft, setDraft] = useState("");
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!lastCheckedAt) return;
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, [lastCheckedAt]);

  const display = lastValidation && !lastValidation.ok ? lastValidation : auth;

  const scopes: ScopeStatus[] = useMemo(
    () =>
      REQUIRED_SCOPES.map((name) => ({
        name,
        status: display?.scopes.includes(name) ? "ok" : "missing",
      })),
    [display],
  );

  const lastCheckedLabel = lastCheckedAt ? dayjs(lastCheckedAt).from(now) : null;

  const onValidate = async () => {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== token) {
      const result = await validateAndSave(trimmed);
      if (result.ok) setDraft("");
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
          value={display?.login ?? ""}
          placeholder="—"
          className={inputClass}
          style={inputStyle()}
        />
      </Field>

      <Field
        label="Personal access token"
        hint="Stored in the macOS Keychain. Never sent anywhere except api.github.com."
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
        {display && (
          <div className="mt-2 flex items-center gap-2 flex-wrap">
            {display.ok ? (
              <Pill tone="success" soft>
                ● valid{display.login ? ` as ${display.login}` : ""}
              </Pill>
            ) : display.error === "no_token" ? null : (
              <Pill tone="warn" soft>
                ● {display.error === "invalid" ? "rejected" : "network error"}
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

      <TeamsField />
    </Stack>
  );
}

// org/team-slug — letters, digits, dot, dash, underscore on each side of the slash.
const TEAM_SLUG_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;

function TeamsField() {
  const teams = useAppStore((s) => s.settings.teams);
  const setSettings = useAppStore((s) => s.setSettings);
  const [saved, setSaved] = useState(false);

  const onChange = (value: string) => {
    setSettings({ teams: value.split("\n") });
  };

  const invalid = useMemo(
    () =>
      teams
        .map((t) => t.trim())
        .filter((t) => t && !TEAM_SLUG_RE.test(t)),
    [teams],
  );

  const onBlur = async () => {
    const seen = new Set<string>();
    const parsed = parseLineList(teams.join("\n"))
      .filter((t) => TEAM_SLUG_RE.test(t))
      .filter((t) => (seen.has(t) ? false : (seen.add(t), true)));
    await setTeams(parsed);
    setSettings({ teams: parsed });
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1200);
  };

  return (
    <Field
      label="Teams to track"
      hint="org/team-slug, one per line. Used to boost PR scoring when the author is on one of these teams."
    >
      <textarea
        value={teams.join("\n")}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder="acme/platform"
        rows={3}
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
      {saved && (
        <div className="mt-2">
          <Pill tone="success" soft>
            saved
          </Pill>
        </div>
      )}
    </Field>
  );
}
