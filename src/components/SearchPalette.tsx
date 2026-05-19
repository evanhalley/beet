"use client";

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { createPortal } from "react-dom";
import { Search } from "lucide-react";
import { useAppStore } from "@/lib/store";
import { matchItems } from "@/lib/search";

export interface SearchPaletteProps {
  open: boolean;
  onClose: () => void;
}

// The outer component owns the open/closed gate. Conditionally rendering the
// inner palette means transient state (query, cursor) initializes naturally
// on each open — no reset effects needed.
export function SearchPalette({ open, onClose }: SearchPaletteProps) {
  if (!open) return null;
  if (typeof document === "undefined") return null;
  return <PaletteContent onClose={onClose} />;
}

function PaletteContent({ onClose }: { onClose: () => void }) {
  const reviewRequests = useAppStore((s) => s.reviewRequests);
  const inFlight = useAppStore((s) => s.inFlight);
  const standaloneRuns = useAppStore((s) => s.standaloneRuns);
  const recentlyResolved = useAppStore((s) => s.recentlyResolved);
  const setSelectedItemId = useAppStore((s) => s.setSelectedItemId);

  const corpus = useMemo(
    () => [
      ...inFlight,
      ...reviewRequests,
      ...standaloneRuns,
      ...recentlyResolved,
    ],
    [inFlight, reviewRequests, standaloneRuns, recentlyResolved],
  );

  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const listRef = useRef<HTMLUListElement | null>(null);

  const results = useMemo(() => matchItems(query, corpus), [query, corpus]);

  // Focus the input on mount. No setState here, so the react-hooks
  // set-state-in-effect rule has nothing to flag.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Clamp at render time so an out-of-range cursor (e.g. corpus shrinks via a
  // poll-loop push while the palette is open) doesn't need a syncing effect.
  const effectiveCursor =
    results.length === 0 ? 0 : Math.min(cursor, results.length - 1);

  const selectAt = (idx: number) => {
    const hit = results[idx];
    if (!hit) return;
    setSelectedItemId(hit.id);
    onClose();
  };

  const onCardKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (results.length === 0) return;
      setCursor((effectiveCursor + 1) % results.length);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      if (results.length === 0) return;
      setCursor((effectiveCursor - 1 + results.length) % results.length);
      return;
    }
    if (e.key === "Enter") {
      e.preventDefault();
      selectAt(effectiveCursor);
      return;
    }
    if (e.key === "Tab") {
      // Two-element focus loop: input ↔ listbox. Prevents focus from leaking
      // out of the palette while it's open.
      e.preventDefault();
      const active = document.activeElement;
      if (active === inputRef.current) {
        listRef.current?.focus();
      } else {
        inputRef.current?.focus();
      }
    }
  };

  const trimmed = query.trim();
  const showEmptyState = trimmed.length > 0 && results.length === 0;

  return createPortal(
    <div
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(0, 0, 0, 0.35)",
        display: "flex",
        alignItems: "flex-start",
        justifyContent: "center",
        paddingTop: "14vh",
        zIndex: 1000,
      }}
    >
      <div
        data-search-palette
        role="dialog"
        aria-modal="true"
        aria-label="Search"
        onKeyDown={onCardKeyDown}
        style={{
          width: "min(560px, 92vw)",
          maxHeight: "60vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--color-panel)",
          border: "1px solid var(--color-border)",
          borderRadius: 12,
          boxShadow: "0 24px 60px rgba(0, 0, 0, 0.35)",
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 12px",
            borderBottom: "1px solid var(--color-border)",
            background: "var(--color-panel-2)",
          }}
        >
          <Search size={14} color="var(--color-text-muted)" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder="Search PRs, runs, repos…"
            aria-label="Search query"
            aria-controls="search-palette-results"
            aria-activedescendant={
              results.length > 0
                ? `search-palette-result-${effectiveCursor}`
                : undefined
            }
            style={{
              flex: 1,
              background: "transparent",
              border: "none",
              outline: "none",
              color: "var(--color-text)",
              fontSize: 13,
            }}
          />
          <span
            className="mono"
            style={{ fontSize: 10, color: "var(--color-text-faint)" }}
          >
            esc
          </span>
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {showEmptyState ? (
            <div
              style={{
                padding: "20px 16px",
                color: "var(--color-text-muted)",
                fontSize: 12.5,
              }}
            >
              <div style={{ fontWeight: 500, marginBottom: 4 }}>No matches</div>
              <div style={{ fontSize: 11.5, color: "var(--color-text-faint)" }}>
                Searches review requests, in-flight PRs, standalone runs, and
                recently resolved. Mentions land in #8.
              </div>
            </div>
          ) : (
            <ul
              id="search-palette-results"
              ref={listRef}
              role="listbox"
              aria-label="Search results"
              tabIndex={-1}
              style={{
                listStyle: "none",
                margin: 0,
                padding: 0,
                outline: "none",
              }}
            >
              {results.map((item, idx) => {
                const active = idx === effectiveCursor;
                return (
                  <li
                    key={item.id}
                    id={`search-palette-result-${idx}`}
                    role="option"
                    aria-selected={active}
                    onMouseEnter={() => setCursor(idx)}
                    onMouseDown={(e) => {
                      // Avoid stealing focus from the input before click runs.
                      e.preventDefault();
                    }}
                    onClick={() => selectAt(idx)}
                    style={{
                      display: "flex",
                      alignItems: "baseline",
                      gap: 8,
                      padding: active
                        ? "8px 14px 8px 12px"
                        : "8px 14px",
                      background: active
                        ? "var(--color-accent-soft)"
                        : "transparent",
                      borderLeft: active
                        ? "2px solid var(--color-accent)"
                        : "2px solid transparent",
                      cursor: "pointer",
                      fontSize: 12.5,
                    }}
                  >
                    <span
                      style={{
                        color: "var(--color-text-muted)",
                        flexShrink: 0,
                      }}
                    >
                      {item.repoFullName}
                    </span>
                    {item.pr ? (
                      <span
                        className="mono"
                        style={{
                          color: "var(--color-text-faint)",
                          flexShrink: 0,
                        }}
                      >
                        #{item.pr.number}
                      </span>
                    ) : null}
                    <span
                      style={{
                        color: "var(--color-text)",
                        flex: 1,
                        whiteSpace: "nowrap",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                      }}
                    >
                      {item.title}
                    </span>
                    {item.pr ? (
                      <span
                        style={{
                          color: "var(--color-text-faint)",
                          flexShrink: 0,
                        }}
                      >
                        @{item.pr.author}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
