export function BeetMark({ size = 18 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" style={{ display: "block" }}>
      <defs>
        <linearGradient id="beet-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--color-accent)" stopOpacity="1" />
          <stop offset="1" stopColor="var(--color-accent)" stopOpacity="0.78" />
        </linearGradient>
      </defs>
      <path d="M12 7 C 10 3, 6 3, 5 4.5 C 6 6, 8 7.5, 12 7 Z" fill="var(--color-leaf)" />
      <path
        d="M12 7 C 14 3, 18 3, 19 4.5 C 18 6, 16 7.5, 12 7 Z"
        fill="var(--color-leaf)"
        opacity="0.85"
      />
      <path
        d="M12 4.5 L12 8"
        stroke="var(--color-leaf)"
        strokeWidth="1.2"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M12 7.5 L 19 13 L 12 21 L 5 13 Z" fill="url(#beet-grad)" />
      <path
        d="M12 11.5 L 16 13.8 L 12 17.5 L 8 13.8 Z"
        fill="rgba(255,255,255,0.18)"
      />
    </svg>
  );
}
