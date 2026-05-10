export interface ScopeStatus {
  name: string;
  status: "ok" | "missing";
}

export function ScopesGrid({ scopes }: { scopes: ScopeStatus[] }) {
  return (
    <div
      className="grid"
      style={{
        gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
        gap: 6,
      }}
      role="list"
    >
      {scopes.map((scope) => {
        const ok = scope.status === "ok";
        return (
          <div
            key={scope.name}
            role="listitem"
            data-testid={`scope-${scope.name}`}
            data-status={scope.status}
            className="flex items-center"
            style={{
              gap: 7,
              padding: "6px 9px",
              borderRadius: 5,
              fontSize: 11,
              background: ok ? "var(--color-success-soft)" : "var(--color-warn-soft)",
              border: `1px solid ${ok ? "var(--color-success-border)" : "var(--color-warn-border)"}`,
            }}
          >
            <span
              style={{
                width: 6,
                height: 6,
                borderRadius: 3,
                background: ok ? "var(--color-success)" : "var(--color-warn)",
              }}
            />
            <span
              className="mono"
              style={{ color: ok ? "var(--color-success)" : "var(--color-warn)" }}
            >
              {scope.name}
            </span>
            {!ok && (
              <span
                style={{
                  marginLeft: "auto",
                  fontSize: 10,
                  color: "var(--color-text-muted)",
                }}
              >
                missing
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}
