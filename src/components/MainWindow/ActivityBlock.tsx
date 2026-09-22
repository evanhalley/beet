"use client";

import type { CSSProperties } from "react";
import { CornerDownRight, FileCode, MessageSquare } from "lucide-react";
import { Pill } from "@/components/Pill";
import { SkeletonBar } from "@/components/SkeletonRow";
import { usePrComments } from "@/hooks/usePrComments";
import dayjs from "@/lib/dayjs";
import { openInBrowser } from "@/lib/openInBrowser";
import type { ActionableItem, PrComment } from "@/lib/types";
import { BlockHeader, EmptyHint } from "./DetailBlocks";

// One conversation entry: a top-level comment plus, for review threads, the
// replies that point back at it via `inReplyToId`.
export interface ActivityThread {
  root: PrComment;
  replies: PrComment[];
}

// Group review replies under their thread root, oldest first. A reply whose
// root isn't in the list (deleted, or past the page limit) stands alone.
export function groupActivity(comments: PrComment[]): ActivityThread[] {
  const sorted = [...comments].sort(
    (a, b) => a.createdAt.localeCompare(b.createdAt) || a.id - b.id,
  );
  const ids = new Set(sorted.map((c) => c.id));
  const threads = new Map<number, ActivityThread>();
  const out: ActivityThread[] = [];
  for (const c of sorted) {
    const rootId = c.inReplyToId;
    if (rootId !== undefined && ids.has(rootId)) {
      threads.get(rootId)?.replies.push(c);
      continue;
    }
    const thread = { root: c, replies: [] };
    threads.set(c.id, thread);
    out.push(thread);
  }
  return out;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// True when `body` @-mentions `username` (case-insensitive, whole handle).
export function mentionsUser(body: string, username: string): boolean {
  if (!username) return false;
  const re = new RegExp(
    `(^|[^\\w-])@${escapeRegExp(username)}(?![\\w-])`,
    "i",
  );
  return re.test(body);
}

const excerptStyle: CSSProperties = {
  fontSize: 12,
  lineHeight: 1.45,
  color: "var(--color-text-muted)",
  display: "-webkit-box",
  WebkitLineClamp: 3,
  WebkitBoxOrient: "vertical",
  overflow: "hidden",
  whiteSpace: "pre-wrap",
  overflowWrap: "anywhere",
};

function ActivityEntry({
  comment,
  username,
  isReply,
}: {
  comment: PrComment;
  username: string;
  isReply: boolean;
}) {
  const mentioned =
    comment.author.toLowerCase() !== username.toLowerCase() &&
    mentionsUser(comment.body, username);
  const Icon = isReply
    ? CornerDownRight
    : comment.kind === "review"
      ? FileCode
      : MessageSquare;

  return (
    <li
      data-mention={mentioned || undefined}
      style={{
        display: "grid",
        gridTemplateColumns: "20px 1fr auto",
        gap: 8,
        padding: "6px 0",
        paddingLeft: isReply ? 20 : 0,
        alignItems: "start",
        borderLeft: mentioned
          ? "2px solid var(--color-accent)"
          : "2px solid transparent",
      }}
    >
      <span
        style={{
          display: "flex",
          justifyContent: "center",
          paddingTop: 2,
          color: mentioned ? "var(--color-accent)" : "var(--color-text-muted)",
        }}
      >
        <Icon size={12} aria-hidden />
      </span>
      <button
        type="button"
        onClick={() => void openInBrowser(comment.htmlUrl)}
        title="Open on GitHub"
        style={{
          minWidth: 0,
          textAlign: "left",
          background: "transparent",
          cursor: "pointer",
          padding: 0,
          color: "inherit",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            marginBottom: 2,
            minWidth: 0,
          }}
        >
          <span style={{ color: "var(--color-text)", fontWeight: 500 }}>
            @{comment.author}
          </span>
          {mentioned && <Pill tone="info">@mention</Pill>}
          {!isReply && comment.path && (
            <span
              className="mono"
              title={comment.path}
              style={{
                fontSize: 10.5,
                color: "var(--color-text-faint)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {comment.path}
            </span>
          )}
        </div>
        <div style={excerptStyle}>{comment.body}</div>
      </button>
      <span
        className="mono"
        style={{
          fontSize: 10.5,
          color: "var(--color-text-faint)",
          whiteSpace: "nowrap",
        }}
      >
        {dayjs(comment.createdAt).fromNow(true)}
      </span>
    </li>
  );
}

function ActivitySkeleton() {
  return (
    <div
      role="status"
      aria-label="Loading activity"
      style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 8 }}
    >
      {[0, 1].map((i) => (
        <div key={i} style={{ display: "flex", flexDirection: "column", gap: 5 }}>
          <SkeletonBar w={90} h={9} delayMs={i * 180} />
          <SkeletonBar w="85%" h={10} delayMs={i * 180 + 60} />
        </div>
      ))}
    </div>
  );
}

/// Conversation + review comments on the selected PR (design/src/main-window.jsx
/// `Block title="Activity"`). Fetched on demand — only for the PR on screen.
/// Comments that @-mention me get an accent rail and pill; review replies nest
/// under the comment that started the thread.
export function ActivityBlock({ item }: { item: ActionableItem }) {
  const { data, isLoading, error } = usePrComments(item);
  const threads = data ? groupActivity(data.comments) : [];

  return (
    <section
      aria-label="Activity"
      style={{
        padding: "10px 16px",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      <BlockHeader title="Activity" />
      {isLoading ? (
        <ActivitySkeleton />
      ) : error ? (
        <EmptyHint>Couldn’t load comments.</EmptyHint>
      ) : threads.length === 0 ? (
        <EmptyHint>No comments yet.</EmptyHint>
      ) : (
        <ul
          role="list"
          style={{ listStyle: "none", margin: "6px 0 0", padding: 0 }}
        >
          {threads.flatMap(({ root, replies }) => [
            <ActivityEntry
              key={root.id}
              comment={root}
              username={data?.username ?? ""}
              isReply={false}
            />,
            ...replies.map((reply) => (
              <ActivityEntry
                key={reply.id}
                comment={reply}
                username={data?.username ?? ""}
                isReply
              />
            )),
          ])}
        </ul>
      )}
    </section>
  );
}
