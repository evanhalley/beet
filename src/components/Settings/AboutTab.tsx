"use client";

import { useState, type ReactNode } from "react";
import { BeetMark } from "@/components/BeetMark";
import { useAppVersion } from "@/hooks/useAppVersion";
import { openInBrowser } from "@/lib/openInBrowser";
import { checkForUpdate, type UpdateCheckResult } from "@/lib/updateCheck";

const REPO_URL = "https://github.com/evanhalley/beet";
const LICENSE_URL = `${REPO_URL}/blob/main/LICENSE`;
const SITE_URL = "https://beet.sh";

// An in-app link that opens in the default browser rather than navigating
// the webview.
function BrowserLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      href={href}
      style={{ color: "var(--color-accent)" }}
      onClick={(e) => {
        e.preventDefault();
        void openInBrowser(href);
      }}
    >
      {children}
    </a>
  );
}

type UpdateState =
  | { phase: "idle" }
  | { phase: "checking" }
  | { phase: "done"; result: UpdateCheckResult }
  | { phase: "error" };

export function AboutTab() {
  const version = useAppVersion();
  const [update, setUpdate] = useState<UpdateState>({ phase: "idle" });

  const onCheck = async () => {
    if (!version) return;
    setUpdate({ phase: "checking" });
    try {
      const result = await checkForUpdate(version);
      setUpdate({ phase: "done", result });
    } catch {
      setUpdate({ phase: "error" });
    }
  };

  return (
    <div
      className="flex flex-col items-center gap-5 pt-10 pb-6 text-center"
    >
      <BeetMark size={56} />
      <div className="flex flex-col items-center gap-1">
        <span style={{ fontSize: 20, fontWeight: 600, letterSpacing: "-0.3px" }}>
          Beet
        </span>
        {version && (
          <span style={{ fontSize: 12.5, color: "var(--color-text-muted)" }}>
            Version {version}
          </span>
        )}
        <span
          style={{
            fontSize: 12.5,
            color: "var(--color-text-faint)",
            marginTop: 6,
          }}
        >
          A glanceable GitHub dashboard.
        </span>
        <span style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}>
          Free and open source under the{" "}
          <BrowserLink href={LICENSE_URL}>MIT License</BrowserLink>.
        </span>
      </div>

      {version && (
        <div className="flex flex-col items-center gap-1.5">
          {update.phase === "done" && update.result.updateAvailable ? (
            <a
              href={update.result.url}
              style={{ fontSize: 12.5, color: "var(--color-accent)" }}
              onClick={(e) => {
                e.preventDefault();
                void openInBrowser(update.result.url);
              }}
            >
              Update available: v{update.result.latest}
            </a>
          ) : (
            <button
              type="button"
              onClick={() => void onCheck()}
              disabled={update.phase === "checking"}
              style={{
                fontSize: 12.5,
                color: "var(--color-accent)",
                background: "transparent",
                cursor: update.phase === "checking" ? "default" : "pointer",
              }}
            >
              {update.phase === "checking" ? "Checking…" : "Check for updates"}
            </button>
          )}
          {update.phase === "done" && !update.result.updateAvailable && (
            <span style={{ fontSize: 11.5, color: "var(--color-text-faint)" }}>
              You&apos;re up to date.
            </span>
          )}
          {update.phase === "error" && (
            <span style={{ fontSize: 11.5, color: "var(--color-text-faint)" }}>
              Couldn&apos;t reach GitHub — try again later.
            </span>
          )}
        </div>
      )}

      <div
        className="flex items-center gap-2"
        style={{ fontSize: 12.5, color: "var(--color-text-faint)" }}
      >
        <BrowserLink href={SITE_URL}>beet.sh</BrowserLink>
        <span aria-hidden>·</span>
        <BrowserLink href={REPO_URL}>github.com/evanhalley/beet</BrowserLink>
      </div>
    </div>
  );
}
