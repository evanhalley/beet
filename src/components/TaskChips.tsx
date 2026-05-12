export interface TaskChipsProps {
  urls: string[];
  max?: number;
}

function labelFor(url: string): string {
  // Strip everything after the last "/" — that's the ID portion like PROJ-123.
  const tail = url.split("/").pop() ?? url;
  return tail || url;
}

export function TaskChips({ urls, max = 3 }: TaskChipsProps) {
  if (!urls.length) return null;
  const shown = urls.slice(0, max);
  const extra = urls.length - shown.length;
  return (
    <span style={{ display: "inline-flex", gap: 3, flexWrap: "nowrap" }}>
      {shown.map((url) => (
        <a
          key={url}
          href={url}
          target="_blank"
          rel="noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 500,
            lineHeight: 1.4,
            padding: "0 5px",
            borderRadius: 3,
            color: "var(--color-info)",
            background: "var(--color-info-soft)",
            border: "0.5px solid transparent",
            letterSpacing: 0,
            textDecoration: "none",
          }}
        >
          {labelFor(url)}
        </a>
      ))}
      {extra > 0 && (
        <span
          className="mono"
          style={{
            fontSize: 10,
            fontWeight: 500,
            lineHeight: 1.4,
            padding: "0 5px",
            borderRadius: 3,
            color: "var(--color-text-faint)",
            background: "var(--color-panel-2)",
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
