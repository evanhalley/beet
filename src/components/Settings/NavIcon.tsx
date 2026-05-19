export type NavIconName =
  | "user"
  | "bell"
  | "refresh"
  | "mute"
  | "score"
  | "theme"
  | "merge"
  | "runs"
  | "info";

const COMMON = {
  width: 14,
  height: 14,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
} as const;

export function NavIcon({ name }: { name: NavIconName }) {
  switch (name) {
    case "user":
      return (
        <svg {...COMMON}>
          <circle cx="8" cy="6" r="2.5" />
          <path d="M3.5 13c.5-2 2.4-3 4.5-3s4 1 4.5 3" />
        </svg>
      );
    case "bell":
      return (
        <svg {...COMMON}>
          <path d="M3.5 11h9l-1-1.5V7a3.5 3.5 0 1 0-7 0v2.5z" />
          <path d="M6.5 12.5a1.5 1.5 0 0 0 3 0" />
        </svg>
      );
    case "refresh":
      return (
        <svg {...COMMON}>
          <path d="M13.5 8a5.5 5.5 0 1 1-1.6-3.9" />
          <path d="M13.5 3v2.5h-2.5" />
        </svg>
      );
    case "mute":
      return (
        <svg {...COMMON}>
          <path d="M3 6.5h2.5L8 4v8L5.5 9.5H3z" />
          <path d="M11 6l3 3M14 6l-3 3" />
        </svg>
      );
    case "score":
      return (
        <svg {...COMMON}>
          <path d="M3 12l3-4 3 2 4-6" />
        </svg>
      );
    case "theme":
      return (
        <svg {...COMMON}>
          <circle cx="8" cy="8" r="3" />
          <path d="M8 2v1.5M8 12.5V14M2 8h1.5M12.5 8H14M3.7 3.7l1 1M11.3 11.3l1 1M3.7 12.3l1-1M11.3 4.7l1-1" />
        </svg>
      );
    case "merge":
      // Two branches feeding into one — git-merge motif.
      return (
        <svg {...COMMON}>
          <circle cx="4" cy="4" r="1.5" />
          <circle cx="4" cy="12" r="1.5" />
          <circle cx="12" cy="8" r="1.5" />
          <path d="M4 5.5v5" />
          <path d="M5.5 4c0 3 2 4 5 4M5.5 12c0-3 2-4 5-4" />
        </svg>
      );
    case "runs":
      // Simple gear/cog motif — matches the Cog icon used in the Sidebar
      // Standalone Runs row, but as an inline SVG to fit the NavIcon set.
      return (
        <svg {...COMMON}>
          <circle cx="8" cy="8" r="2.5" />
          <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.5 3.5l1.4 1.4M11.1 11.1l1.4 1.4M3.5 12.5l1.4-1.4M11.1 4.9l1.4-1.4" />
        </svg>
      );
    case "info":
      return (
        <svg {...COMMON}>
          <circle cx="8" cy="8" r="5.5" />
          <path d="M8 7.5v4" />
          <path d="M8 5.2v.8" strokeWidth={2} />
        </svg>
      );
  }
}
