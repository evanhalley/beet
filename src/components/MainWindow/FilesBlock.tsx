"use client";

import { useState } from "react";
import { AlertTriangle, ExternalLink } from "lucide-react";
import { Pill, type PillTone } from "@/components/Pill";
import { diffUrl, ownedFilesUrl, usePrFiles } from "@/hooks/usePrFiles";
import { openInBrowser } from "@/lib/openInBrowser";
import type { ActionableItem, PrChangedFile, PrFilesResult } from "@/lib/types";
import { BlockHeader, EmptyHint } from "./DetailBlocks";

export type FilesView = "mine" | "all";

/// Start on "My files" only when there is something to filter to. With no
/// CODEOWNERS, or nothing owned, the filtered view would be empty and the
/// note above the list explains why.
export function defaultFilesView(r: PrFilesResult): FilesView {
  return r.hasCodeowners && r.ownedCount > 0 ? "mine" : "all";
}

/// Changed files of the selected PR, filterable to the ones the user owns via
/// CODEOWNERS. Mount with `key={item.id}` so the view choice resets per PR.
export function FilesBlock({ item }: { item: ActionableItem }) {
  const { data, isLoading, error } = usePrFiles(item);
  // null = "use the derived default"; set once the user toggles.
  const [chosen, setChosen] = useState<FilesView | null>(null);

  return (
    <section
      aria-label="Files"
      style={{
        padding: "10px 16px",
        borderTop: "1px solid var(--color-border)",
      }}
    >
      {isLoading || !data ? (
        <>
          <BlockHeader title="Files" />
          {isLoading ? (
            <EmptyHint>Loading files…</EmptyHint>
          ) : (
            <EmptyHint>{`Couldn't load files: ${error ?? "unknown error"}`}</EmptyHint>
          )}
        </>
      ) : (
        <Loaded
          data={data}
          prUrl={item.url}
          view={chosen ?? defaultFilesView(data)}
          onChangeView={setChosen}
        />
      )}
    </section>
  );
}

function Loaded({
  data,
  prUrl,
  view,
  onChangeView,
}: {
  data: PrFilesResult;
  prUrl: string;
  view: FilesView;
  onChangeView: (v: FilesView) => void;
}) {
  const visible = view === "mine" ? data.files.filter((f) => f.ownedByMe) : data.files;
  const hidden = data.totalCount - visible.length;

  return (
    <>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <BlockHeader title="Files" />
        <span style={{ flex: 1 }} />
        {data.hasCodeowners && (
          <ViewToggle
            view={view}
            onChange={onChangeView}
            ownedCount={data.ownedCount}
            totalCount={data.totalCount}
          />
        )}
        {data.ownedCount > 0 && (
          <button
            type="button"
            onClick={() => void openInBrowser(ownedFilesUrl(prUrl, data.username))}
            aria-label="Open my files on GitHub"
            title="Open GitHub's Files tab filtered to files you own"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "2px 8px",
              borderRadius: 6,
              fontSize: 11,
              fontWeight: 500,
              background: "transparent",
              color: "var(--color-text-muted)",
              border: "1px solid var(--color-border)",
              cursor: "pointer",
            }}
          >
            <ExternalLink size={11} />
            My files
          </button>
        )}
      </div>

      {!data.teamsResolved && (
        <div
          role="note"
          style={{
            display: "flex",
            alignItems: "flex-start",
            gap: 8,
            marginTop: 8,
            padding: "6px 8px",
            borderRadius: 6,
            fontSize: 11.5,
            background: "var(--color-warn-soft)",
            border: "1px solid var(--color-warn-border)",
            color: "var(--color-text)",
          }}
        >
          <AlertTriangle size={13} style={{ color: "var(--color-warn)", flexShrink: 0, marginTop: 1 }} />
          <span>
            Can&apos;t resolve team ownership: the token lacks <span className="mono">read:org</span>.
            Only rules naming you directly are matched.
          </span>
        </div>
      )}

      {!data.hasCodeowners ? (
        <EmptyHint>No CODEOWNERS in this repo.</EmptyHint>
      ) : data.ownedCount === 0 ? (
        <EmptyHint>No files owned by you.</EmptyHint>
      ) : null}

      {visible.length === 0 ? (
        <EmptyHint>No changed files.</EmptyHint>
      ) : (
        <ul
          aria-label="Changed files"
          style={{
            listStyle: "none",
            margin: "6px 0 0",
            padding: 0,
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          {visible.map((f) => (
            <li key={f.path}>
              <FileRow file={f} prUrl={prUrl} username={data.username} />
            </li>
          ))}
        </ul>
      )}

      {view === "mine" && hidden > 0 && (
        <div style={{ marginTop: 6, fontSize: 11, color: "var(--color-text-faint)" }}>
          {hidden === 1 ? "1 file hidden by this filter" : `${hidden} files hidden by this filter`}
        </div>
      )}
      {data.truncated && (
        <div style={{ marginTop: 4, fontSize: 11, color: "var(--color-text-faint)" }}>
          List truncated at 3000 files (GitHub limit)
        </div>
      )}
    </>
  );
}

function ViewToggle({
  view,
  onChange,
  ownedCount,
  totalCount,
}: {
  view: FilesView;
  onChange: (v: FilesView) => void;
  ownedCount: number;
  totalCount: number;
}) {
  const options: { id: FilesView; label: string }[] = [
    { id: "mine", label: `My files (${ownedCount})` },
    { id: "all", label: `All files (${totalCount})` },
  ];
  return (
    <div
      role="group"
      aria-label="Files view"
      style={{
        display: "inline-flex",
        borderRadius: 6,
        border: "1px solid var(--color-border)",
        overflow: "hidden",
      }}
    >
      {options.map((o) => {
        const active = o.id === view;
        return (
          <button
            key={o.id}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(o.id)}
            style={{
              padding: "2px 8px",
              fontSize: 11,
              fontWeight: 500,
              background: active ? "var(--color-accent-soft)" : "transparent",
              color: active ? "var(--color-accent)" : "var(--color-text-muted)",
              border: 0,
              cursor: "pointer",
            }}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

// One-letter change status per row (the `git status` shorthand), with the
// full word behind a hover tooltip.
const STATUS_GLYPH: Record<string, { letter: string; label: string; tone: PillTone }> = {
  added: { letter: "A", label: "Added", tone: "success" },
  modified: { letter: "M", label: "Modified", tone: "neutral" },
  removed: { letter: "D", label: "Deleted", tone: "danger" },
  renamed: { letter: "R", label: "Renamed", tone: "info" },
  copied: { letter: "C", label: "Copied", tone: "info" },
  changed: { letter: "M", label: "Changed", tone: "neutral" },
};
const UNKNOWN_GLYPH = { letter: "M", label: "Modified", tone: "neutral" as PillTone };

function splitPath(path: string): { dir: string; base: string } {
  const i = path.lastIndexOf("/");
  return i === -1 ? { dir: "", base: path } : { dir: path.slice(0, i + 1), base: path.slice(i + 1) };
}

function FileRow({
  file,
  prUrl,
  username,
}: {
  file: PrChangedFile;
  prUrl: string;
  username: string;
}) {
  const glyph = STATUS_GLYPH[file.status] ?? UNKNOWN_GLYPH;
  const { dir, base } = splitPath(file.path);
  const href = diffUrl(prUrl, file.anchor, file.ownedByMe ? username : undefined);
  return (
    <button
      type="button"
      onClick={() => void openInBrowser(href)}
      aria-label={`Open ${file.path} diff on GitHub`}
      title="Open diff on GitHub"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "4px 0",
        background: "transparent",
        border: 0,
        cursor: "pointer",
        textAlign: "left",
        minWidth: 0,
      }}
    >
      <Pill tone={glyph.tone} mono title={glyph.label} style={{ padding: "0 5px", fontSize: 10 }}>
        {glyph.letter}
      </Pill>
      <span
        className="mono"
        style={{
          fontSize: 12,
          color: "var(--color-text)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          minWidth: 0,
        }}
      >
        {file.previousPath && (
          <span style={{ color: "var(--color-text-faint)" }}>{`${file.previousPath} → `}</span>
        )}
        {dir && <span style={{ color: "var(--color-text-faint)" }}>{dir}</span>}
        {base}
      </span>
      <span style={{ flex: 1 }} />
      {file.ownedByMe &&
        file.owners.map((o) => (
          <Pill key={o} tone="accent">
            {o}
          </Pill>
        ))}
      <span className="mono" style={{ fontSize: 11, whiteSpace: "nowrap" }}>
        <span style={{ color: "var(--color-success)" }}>+{file.additions}</span>{" "}
        <span style={{ color: "var(--color-danger)" }}>−{file.deletions}</span>
      </span>
    </button>
  );
}
