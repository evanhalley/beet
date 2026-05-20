"use client";

import { useState, type MouseEvent } from "react";
import { Check, ExternalLink, Link2, RefreshCw } from "lucide-react";
import Markdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Avatar } from "@/components/Avatar";
import { CheckDot, deriveCheckDotState } from "@/components/CheckDot";
import { Lifecycle } from "@/components/Lifecycle";
import { Pill, type PillTone } from "@/components/Pill";
import { ScoreBar } from "@/components/ScoreBar";
import { useRequeueHistory } from "@/hooks/useRequeueHistory";
import { useRunJobs } from "@/hooks/useRunJobs";
import { copyToClipboard } from "@/lib/copyToClipboard";
import dayjs from "@/lib/dayjs";
import { durationSeconds, formatDuration } from "@/lib/duration";
import { openInBrowser } from "@/lib/openInBrowser";
import { useAppStore } from "@/lib/store";
import type {
  ActionableItem,
  AssociatedRun,
  CheckRunSummary,
  ReviewerEntry,
  WorkflowJobSummary,
} from "@/lib/types";

// Override <a> to dispatch through tauri-plugin-shell (otherwise links open
// inside the embedded webview instead of the user's browser). Style the rest
// for a tight side-panel: smaller headings, compact lists, monospace code.
const MARKDOWN_COMPONENTS: Components = {
  a: ({ href, children }) => (
    <button
      type="button"
      onClick={() => href && void openInBrowser(href)}
      style={{
        color: "var(--color-accent)",
        background: "transparent",
        padding: 0,
        textDecoration: "underline",
        cursor: "pointer",
        font: "inherit",
      }}
    >
      {children}
    </button>
  ),
  p: ({ children }) => (
    <p style={{ margin: "0 0 8px", lineHeight: 1.5 }}>{children}</p>
  ),
  h1: ({ children }) => (
    <h3 style={{ margin: "10px 0 6px", fontSize: 13, fontWeight: 600 }}>
      {children}
    </h3>
  ),
  h2: ({ children }) => (
    <h4 style={{ margin: "10px 0 6px", fontSize: 12.5, fontWeight: 600 }}>
      {children}
    </h4>
  ),
  h3: ({ children }) => (
    <h5 style={{ margin: "8px 0 4px", fontSize: 12, fontWeight: 600 }}>
      {children}
    </h5>
  ),
  ul: ({ children }) => (
    <ul style={{ margin: "0 0 8px", paddingLeft: 18 }}>{children}</ul>
  ),
  ol: ({ children }) => (
    <ol style={{ margin: "0 0 8px", paddingLeft: 18 }}>{children}</ol>
  ),
  li: ({ children }) => <li style={{ margin: "2px 0" }}>{children}</li>,
  blockquote: ({ children }) => (
    <blockquote
      style={{
        margin: "0 0 8px",
        padding: "0 8px",
        borderLeft: "2px solid var(--color-border)",
        color: "var(--color-text-muted)",
      }}
    >
      {children}
    </blockquote>
  ),
  code: ({ className, children }) => {
    const isBlock = (className ?? "").startsWith("language-");
    if (isBlock) {
      return (
        <code
          className={className}
          style={{
            fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
            fontSize: 11.5,
          }}
        >
          {children}
        </code>
      );
    }
    return (
      <code
        style={{
          fontFamily: "var(--font-mono, ui-monospace, SFMono-Regular, monospace)",
          fontSize: "0.92em",
          background: "var(--color-panel-2)",
          padding: "1px 4px",
          borderRadius: 3,
        }}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre
      style={{
        margin: "0 0 8px",
        padding: 8,
        background: "var(--color-panel-2)",
        borderRadius: 4,
        overflowX: "auto",
        fontSize: 11.5,
        lineHeight: 1.5,
      }}
    >
      {children}
    </pre>
  ),
  hr: () => (
    <hr
      style={{
        border: 0,
        borderTop: "1px solid var(--color-border)",
        margin: "10px 0",
      }}
    />
  ),
  img: ({ src, alt }) => (
    // PR-body images come from arbitrary GitHub user content; next/image's
    // server-side optimizer can't reach them from a static Tauri build.
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={typeof src === "string" ? src : undefined}
      alt={alt ?? ""}
      style={{ maxWidth: "100%", borderRadius: 4 }}
    />
  ),
  table: ({ children }) => (
    <table
      style={{
        margin: "0 0 8px",
        borderCollapse: "collapse",
        fontSize: 11.5,
      }}
    >
      {children}
    </table>
  ),
  th: ({ children }) => (
    <th
      style={{
        padding: "4px 8px",
        borderBottom: "1px solid var(--color-border)",
        textAlign: "left",
        fontWeight: 600,
      }}
    >
      {children}
    </th>
  ),
  td: ({ children }) => (
    <td
      style={{
        padding: "4px 8px",
        borderBottom: "1px solid var(--color-border)",
      }}
    >
      {children}
    </td>
  ),
};

function BlockHeader({ title }: { title: string }) {
  return (
    <div
      style={{
        fontSize: 10,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.06,
        color: "var(--color-text-faint)",
      }}
    >
      {title}
    </div>
  );
}

function BodyBlock({ body }: { body: string | null }) {
  const trimmed = body?.trim() ?? "";
  return (
    <section
      aria-label="Body"
      style={{
        padding: "10px 16px",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <BlockHeader title="Body" />
      {trimmed === "" ? (
        <div
          style={{
            marginTop: 4,
            fontSize: 11.5,
            color: "var(--color-text-faint)",
            fontStyle: "italic",
          }}
        >
          No description.
        </div>
      ) : (
        <div
          style={{
            marginTop: 6,
            fontSize: 12,
            color: "var(--color-text)",
            wordBreak: "break-word",
          }}
        >
          <Markdown
            remarkPlugins={[remarkGfm]}
            components={MARKDOWN_COMPONENTS}
          >
            {trimmed}
          </Markdown>
        </div>
      )}
    </section>
  );
}

// Italic faint line used by every empty-state in the side panel — matches the
// "No description." styling already used by BodyBlock so each block's empty
// state feels consistent with the others.
function EmptyHint({ children }: { children: string }) {
  return (
    <div
      style={{
        marginTop: 6,
        fontSize: 11.5,
        color: "var(--color-text-faint)",
        fontStyle: "italic",
      }}
    >
      {children}
    </div>
  );
}

const REVIEWER_PILL: Record<string, { tone: PillTone; label: string }> = {
  // Literal mapping from the design (design/src/main-window.jsx:301-303).
  approved: { tone: "success", label: "approved" },
  changes_requested: { tone: "danger", label: "changes requested" },
  requested: { tone: "info", label: "awaiting" },
};

function ReviewerPill({ state }: { state: string }) {
  const known = REVIEWER_PILL[state];
  if (known) {
    return <Pill tone={known.tone}>{known.label}</Pill>;
  }
  // Real GitHub states the design doesn't enumerate (commented, dismissed,
  // pending) fall through as neutral so we don't lose the reviewer.
  return <Pill tone="neutral">{state}</Pill>;
}

function ReviewersBlock({ reviewers }: { reviewers: ReviewerEntry[] | undefined }) {
  return (
    <section
      aria-label="Reviewers"
      style={{
        padding: "10px 16px",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <BlockHeader title="Reviewers" />
      {!reviewers || reviewers.length === 0 ? (
        <EmptyHint>No reviewers yet.</EmptyHint>
      ) : (
        <div
          style={{
            marginTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 6,
          }}
        >
          {reviewers.map((r) => (
            <div
              key={r.login}
              style={{ display: "flex", alignItems: "center", gap: 8 }}
            >
              <Avatar login={r.login} size={18} />
              <span style={{ fontSize: 12.5, fontWeight: 500 }}>@{r.login}</span>
              <span style={{ flex: 1 }} />
              <ReviewerPill state={r.state} />
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ChecksBlock({
  runs,
  associated,
}: {
  runs: CheckRunSummary[] | undefined;
  associated?: AssociatedRun[];
}) {
  const hasChecks = (runs?.length ?? 0) > 0;
  const hasAssociated = (associated?.length ?? 0) > 0;
  return (
    <section
      aria-label="Checks"
      style={{
        padding: "10px 16px",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <BlockHeader title="Checks" />
      {!hasChecks && !hasAssociated ? (
        <EmptyHint>No checks reported for this commit.</EmptyHint>
      ) : (
        <div
          style={{
            marginTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {(runs ?? []).map((r, i) => (
            <div
              key={`check-${r.name}-${i}`}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "5px 0",
              }}
            >
              <CheckDot state={deriveCheckDotState(r.status, r.conclusion)} />
              <span
                className="mono"
                style={{ fontSize: 12, color: "var(--color-text)" }}
              >
                {r.name}
              </span>
              <span style={{ flex: 1 }} />
              <span
                className="mono"
                style={{ fontSize: 11, color: "var(--color-text-faint)" }}
              >
                {r.status === "in_progress" ? "running…" : r.conclusion ?? ""}
              </span>
            </div>
          ))}
          {hasAssociated && (
            <>
              {hasChecks && (
                <div
                  style={{
                    margin: "6px 0 2px",
                    fontSize: 10,
                    fontWeight: 600,
                    textTransform: "uppercase",
                    letterSpacing: 0.06,
                    color: "var(--color-text-faint)",
                  }}
                >
                  Workflow runs
                </div>
              )}
              {(associated ?? []).map((a) => (
                <div
                  key={`run-${a.workflowName}`}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "5px 0",
                  }}
                >
                  <CheckDot
                    state={deriveCheckDotState(a.status, a.conclusion)}
                  />
                  <button
                    type="button"
                    onClick={() => void openInBrowser(a.runUrl)}
                    title={`Open ${a.workflowName} on GitHub`}
                    style={{
                      fontSize: 12,
                      color: "var(--color-text)",
                      background: "transparent",
                      padding: 0,
                      cursor: "pointer",
                      textAlign: "left",
                    }}
                  >
                    {a.workflowName}
                  </button>
                  <span style={{ flex: 1 }} />
                  <span
                    className="mono"
                    style={{ fontSize: 11, color: "var(--color-text-faint)" }}
                  >
                    {a.status === "in_progress"
                      ? "running…"
                      : a.conclusion ?? a.status}
                  </span>
                </div>
              ))}
            </>
          )}
        </div>
      )}
    </section>
  );
}

// One row in the detail's metadata grid. `value` is rendered raw; `title`
// puts the absolute timestamp behind a hover tooltip on relative dates.
function MetaRow({
  label,
  value,
  title,
  mono = false,
}: {
  label: string;
  value: React.ReactNode;
  title?: string;
  mono?: boolean;
}) {
  return (
    <>
      <dt style={{ color: "var(--color-text-faint)" }}>{label}</dt>
      <dd
        className={mono ? "mono" : undefined}
        style={{ margin: 0 }}
        title={title}
      >
        {value}
      </dd>
    </>
  );
}

function JobsBlock({ item }: { item: ActionableItem }) {
  const { jobs, isLoading, error } = useRunJobs(item);
  return (
    <section
      aria-label="Jobs"
      style={{
        padding: "10px 16px",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <BlockHeader title="Jobs" />
      {isLoading ? (
        <EmptyHint>Loading jobs…</EmptyHint>
      ) : error ? (
        <EmptyHint>{`Failed to load jobs: ${error}`}</EmptyHint>
      ) : jobs.length === 0 ? (
        <EmptyHint>No jobs reported.</EmptyHint>
      ) : (
        <div
          style={{
            marginTop: 6,
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          {jobs.map((job) => (
            <JobRow key={job.id} job={job} />
          ))}
        </div>
      )}
    </section>
  );
}

function JobRow({ job }: { job: WorkflowJobSummary }) {
  const dur = durationSeconds(job.startedAt, job.completedAt);
  const durText = dur != null ? formatDuration(dur) : null;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "5px 0",
      }}
    >
      <CheckDot state={deriveCheckDotState(job.status, job.conclusion)} />
      {job.htmlUrl ? (
        <button
          type="button"
          onClick={() => void openInBrowser(job.htmlUrl as string)}
          title={`Open ${job.name} on GitHub`}
          style={{
            fontSize: 12,
            color: "var(--color-text)",
            background: "transparent",
            padding: 0,
            cursor: "pointer",
            textAlign: "left",
          }}
        >
          {job.name}
        </button>
      ) : (
        <span style={{ fontSize: 12, color: "var(--color-text)" }}>
          {job.name}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {durText && (
        <span
          className="mono"
          style={{ fontSize: 11, color: "var(--color-text-faint)" }}
        >
          {durText}
        </span>
      )}
      <span
        className="mono"
        style={{ fontSize: 11, color: "var(--color-text-faint)" }}
      >
        {job.status === "in_progress" ? "running…" : (job.conclusion ?? job.status)}
      </span>
    </div>
  );
}

function RunDetail({ item }: { item: ActionableItem }) {
  const run = item.run;
  const [copied, setCopied] = useState(false);
  if (!run) return null;

  const branchLabel = run.branch ?? (run.sha ? run.sha.slice(0, 7) : "");

  const onCopy = async (e: MouseEvent) => {
    e.stopPropagation();
    const ok = await copyToClipboard(run.runUrl);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    }
  };

  const startedRelative = run.startedAt ? dayjs(run.startedAt).fromNow() : null;
  const completedRelative = run.completedAt
    ? dayjs(run.completedAt).fromNow()
    : null;
  const durSecs = durationSeconds(run.startedAt, run.completedAt);
  const durText = durSecs != null ? formatDuration(durSecs) : null;

  return (
    <div
      aria-label="Detail"
      style={{
        background: "var(--color-bg-elev)",
        borderLeft: "1px solid var(--color-border)",
        overflow: "auto",
      }}
    >
      <header style={{ padding: "14px 16px 12px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "var(--color-text-faint)",
          }}
        >
          <span className="mono">{item.repoFullName}</span>
          {branchLabel && <span className="mono">{branchLabel}</span>}
          <Pill tone="neutral">{run.event}</Pill>
        </div>
        <h2
          style={{
            margin: "6px 0 8px",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {run.workflowName}
        </h2>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <CheckDot state={deriveCheckDotState(run.status, run.conclusion)} />
          <span style={{ fontSize: 12, color: "var(--color-text-muted)" }}>
            {run.status === "in_progress"
              ? "running…"
              : (run.conclusion ?? run.status)}
          </span>
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={onCopy}
            aria-label={`Copy ${run.workflowName} run URL`}
            title={copied ? "Copied!" : "Copy run URL"}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 8px",
              borderRadius: 6,
              fontSize: 11.5,
              fontWeight: 500,
              background: copied ? "var(--color-success-soft)" : "transparent",
              color: copied ? "var(--color-success)" : "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
              cursor: "pointer",
            }}
          >
            {copied ? <Check size={12} /> : <Link2 size={12} />}
            {copied ? "Copied" : "Copy link"}
          </button>
          <button
            type="button"
            onClick={() => void openInBrowser(run.runUrl)}
            aria-label={`Open ${run.workflowName} on GitHub`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11.5,
              fontWeight: 500,
              background: "var(--color-accent)",
              color: "var(--color-accent-fg)",
              border: "1px solid var(--color-accent)",
              cursor: "pointer",
            }}
          >
            <ExternalLink size={12} />
            Open on GitHub
          </button>
        </div>
      </header>
      <section
        aria-label="Run details"
        style={{
          padding: "10px 16px",
          borderTop: "1px solid var(--color-border)",
        }}
      >
        <BlockHeader title="Run" />
        <dl
          style={{
            display: "grid",
            gridTemplateColumns: "auto 1fr",
            gap: "4px 12px",
            margin: "6px 0 0",
            fontSize: 12,
          }}
        >
          <MetaRow label="Actor" value={`@${run.actorLogin}`} />
          <MetaRow label="Run #" value={run.runNumber} mono />
          <MetaRow label="SHA" value={run.sha.slice(0, 12)} mono />
          {startedRelative && (
            <MetaRow
              label="Started"
              value={`${startedRelative}`}
              title={run.startedAt ?? undefined}
            />
          )}
          {completedRelative && (
            <MetaRow
              label="Completed"
              value={`${completedRelative}`}
              title={run.completedAt ?? undefined}
            />
          )}
          {durText && <MetaRow label="Duration" value={durText} mono />}
        </dl>
      </section>
      <JobsBlock item={item} />
    </div>
  );
}

export interface DetailPaneProps {
  item: ActionableItem | null;
}

function PlaceholderBlock({ title, hint }: { title: string; hint: string }) {
  return (
    <section
      aria-label={title}
      style={{
        padding: "10px 16px",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.06,
          color: "var(--color-text-faint)",
        }}
      >
        {title}
      </div>
      <div style={{ marginTop: 4, fontSize: 11.5, color: "var(--color-text-faint)" }}>
        {hint}
      </div>
    </section>
  );
}

export function DetailPane({ item }: DetailPaneProps) {
  const pr = item?.pr ?? null;
  const headSha = pr?.mergeQueue?.headSha ?? null;
  // Cold-start signal — the Rust poll loop hasn't produced its first result
  // yet. Read directly off the store so we don't have to thread it through
  // MainWindowShell just for the empty state.
  const pollState = useAppStore((s) => s.pollState);
  const isLoading = pollState === "idle";
  // Only authored PRs are ever auto-requeued, so the toggle/badge are only
  // meaningful in that case — for review-requests, the headSha will usually
  // be absent anyway and the hook returns the empty state. Called above the
  // early return so the hook order stays stable across renders.
  const requeue = useRequeueHistory(
    item && pr?.isAuthoredByMe ? item.id : null,
    pr?.isAuthoredByMe ? headSha : null,
  );

  if (!item) {
    return (
      <div
        aria-label="Detail"
        role={isLoading ? "status" : undefined}
        aria-live={isLoading ? "polite" : undefined}
        style={{
          background: "var(--color-bg-elev)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          color: "var(--color-text-faint)",
          fontSize: 12,
        }}
      >
        {isLoading ? (
          <>
            <RefreshCw
              size={12}
              aria-hidden
              style={{ animation: "beet-spin .9s linear infinite" }}
            />
            <span>Loading…</span>
          </>
        ) : (
          "Select an item."
        )}
      </div>
    );
  }
  if (!pr && item.run) {
    return <RunDetail item={item} />;
  }
  if (!pr) {
    return (
      <div
        aria-label="Detail"
        style={{
          background: "var(--color-bg-elev)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--color-text-faint)",
          fontSize: 12,
        }}
      >
        Select an item.
      </div>
    );
  }

  return (
    <div
      aria-label="Detail"
      style={{
        background: "var(--color-bg-elev)",
        borderLeft: "1px solid var(--color-border)",
        overflow: "auto",
      }}
    >
      <header style={{ padding: "14px 16px 12px" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 11,
            color: "var(--color-text-faint)",
          }}
        >
          <span className="mono">{item.repoFullName}</span>
          <span className="mono">#{pr.number}</span>
          <span className="mono" style={{ color: "var(--color-text-faint)" }}>
            {/* Branch placeholder — fetched in #5. */}
            branch
          </span>
        </div>
        <h2
          style={{
            margin: "6px 0 8px",
            fontSize: 14,
            fontWeight: 600,
            color: "var(--color-text)",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          {item.title}
        </h2>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <Lifecycle
            state={pr.lifecycle}
            mqPos={pr.mergeQueue?.position ?? null}
          />
          {requeue.count > 0 && (
            <Pill tone="neutral">Auto-requeued {requeue.count}×</Pill>
          )}
          <ScoreBar score={pr.score} width={36} />
          <span style={{ flex: 1 }} />
          <button
            type="button"
            onClick={() => void openInBrowser(item.url)}
            aria-label={`Open ${item.title} on GitHub`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              padding: "4px 10px",
              borderRadius: 6,
              fontSize: 11.5,
              fontWeight: 500,
              background: "var(--color-accent)",
              color: "var(--color-accent-fg)",
              border: "1px solid var(--color-accent)",
              cursor: "pointer",
            }}
          >
            <ExternalLink size={12} />
            Open on GitHub
          </button>
        </div>
        {pr.isAuthoredByMe && headSha && (
          <label
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              marginTop: 10,
              fontSize: 11.5,
              color: "var(--color-text-muted)",
            }}
          >
            <input
              type="checkbox"
              checked={requeue.optOut}
              onChange={(e) => void requeue.setOptOut(e.target.checked)}
              aria-label="Don't auto-requeue this PR"
            />
            Don&apos;t auto-requeue this PR
          </label>
        )}
      </header>

      <BodyBlock body={pr.body} />
      <ReviewersBlock reviewers={pr.reviewers} />
      <ChecksBlock runs={pr.checkRuns} associated={pr.associatedRuns} />
      <PlaceholderBlock title="Activity" hint="lands in #8" />
    </div>
  );
}
