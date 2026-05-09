/* Beet — shared UI primitives.
   Icons are inline SVG (lucide-style strokes) — no lucide-react in a static prototype.
   The beet monogram is a custom mark: a tilted leaf-topped tuber rendered as a
   geometric stack of two stroked beet-shaped diamonds + a leaf, in the accent. */

// ─────────── icons ───────────
const I = {
  refresh: (p={}) => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M14 8a6 6 0 1 1-1.76-4.24"/><path d="M14 2v3.5h-3.5"/></svg>,
  settings: (p={}) => <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="8" cy="8" r="2"/><path d="M13 9.5V6.5l-1.5-.6-.6-1.5L11.5 3 9.4 1l-1.4.9h-2L4.6 1 2.5 3l.6 1.4-.6 1.5L1 6.5v3l1.5.6.6 1.5-.6 1.4L4.6 15l1.4-.9h2l1.4.9 2.1-2-.6-1.4.6-1.5z"/></svg>,
  expand: (p={}) => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 2h5v5M14 2 9 7M7 14H2V9M2 14l5-5"/></svg>,
  ext: (p={}) => <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M6 3H3v10h10v-3M9 2h5v5M14 2 8 8"/></svg>,
  chev: (p={}) => <svg width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 6l4 4 4-4"/></svg>,
  dot: (p={}) => <svg width="6" height="6" viewBox="0 0 6 6" {...p}><circle cx="3" cy="3" r="3" fill="currentColor"/></svg>,
  check: (p={}) => <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 8.5l3 3 7-7"/></svg>,
  x: (p={}) => <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" {...p}><path d="M4 4l8 8M12 4l-8 8"/></svg>,
  zzz: (p={}) => <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M4 4h5L4 12h5M9 7h3l-3 5h3"/></svg>,
  mute: (p={}) => <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M3 6h2l3-2v8l-3-2H3zM10.5 6.5l3 3M13.5 6.5l-3 3"/></svg>,
  pin: (p={}) => <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M9 2l5 5-2 1-2 4-4-4-4 2 1-2 5-5z"/></svg>,
  search: (p={}) => <svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="7" cy="7" r="4.5"/><path d="m13 13-2.7-2.7"/></svg>,
  filter: (p={}) => <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M2 3h12l-4.5 6V14L6.5 13V9z"/></svg>,
  diff: (p={}) => <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="4" cy="3.5" r="1.5"/><path d="M4 5v6"/><circle cx="4" cy="12" r="1.5"/><path d="M12 4v7M12 4l-2 2M12 4l2 2"/></svg>,
  msg: (p={}) => <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M2 4a1 1 0 011-1h10a1 1 0 011 1v6a1 1 0 01-1 1H7l-3 2v-2H3a1 1 0 01-1-1z"/></svg>,
  branch: (p={}) => <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><circle cx="4" cy="3" r="1.5"/><circle cx="4" cy="13" r="1.5"/><circle cx="12" cy="6" r="1.5"/><path d="M4 4.5v7M4 8c4 0 8 0 8-2.5"/></svg>,
  play: (p={}) => <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor" {...p}><path d="M4 3l9 5-9 5z"/></svg>,
  alert: (p={}) => <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" {...p}><path d="M8 2 1.5 13h13z"/><path d="M8 6v3M8 11v.01"/></svg>,
};

// ─────────── beet monogram ───────────
// Geometric stack: two diamond/teardrop shapes (the tuber) + leaf above.
// Renders crisp at 14–48px. Color comes from currentColor + accent fill.
function BeetMark({ size = 18, status = "ok" }) {
  const s = size;
  return (
    <svg width={s} height={s} viewBox="0 0 24 24" style={{ display:"block" }}>
      <defs>
        <linearGradient id="beet-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="var(--accent)" stopOpacity="1"/>
          <stop offset="1" stopColor="var(--accent)" stopOpacity="0.78"/>
        </linearGradient>
      </defs>
      {/* leaf */}
      <path d="M12 7 C 10 3, 6 3, 5 4.5 C 6 6, 8 7.5, 12 7 Z" fill="var(--leaf)"/>
      <path d="M12 7 C 14 3, 18 3, 19 4.5 C 18 6, 16 7.5, 12 7 Z" fill="var(--leaf)" opacity="0.85"/>
      <path d="M12 4.5 L12 8" stroke="var(--leaf)" strokeWidth="1.2" strokeLinecap="round" fill="none"/>
      {/* tuber: two stacked rhombi for a beet silhouette */}
      <path d="M12 7.5 L 19 13 L 12 21 L 5 13 Z" fill="url(#beet-grad)"/>
      <path d="M12 11.5 L 16 13.8 L 12 17.5 L 8 13.8 Z" fill="rgba(255,255,255,0.18)"/>
      {/* status dot */}
      {status === "alert" && <circle cx="19" cy="5" r="3.4" fill="var(--danger)" stroke="var(--bg)" strokeWidth="1.2"/>}
      {status === "paused" && <circle cx="19" cy="5" r="3.4" fill="var(--warn)" stroke="var(--bg)" strokeWidth="1.2"/>}
    </svg>
  );
}

// ─────────── badges ───────────
function Pill({ children, tone = "neutral", soft = true, mono = false, style }) {
  const map = {
    neutral: ["var(--text-muted)", "var(--panel-2)", "var(--border)"],
    success: ["var(--success)", "var(--success-soft)", "transparent"],
    danger:  ["var(--danger)",  "var(--danger-soft)",  "transparent"],
    warn:    ["var(--warn)",    "var(--warn-soft)",    "transparent"],
    info:    ["var(--info)",    "var(--info-soft)",    "transparent"],
    accent:  ["var(--accent)",  "var(--accent-soft)",  "transparent"],
  };
  const [c, bg, bd] = map[tone] || map.neutral;
  return (
    <span className={mono ? "mono" : ""} style={{
      display: "inline-flex", alignItems:"center", gap: 4,
      padding: "1px 6px", borderRadius: 999,
      fontSize: 11, fontWeight: 500, lineHeight: 1.5,
      color: c, background: soft ? bg : "transparent",
      border: soft ? "0" : `1px solid ${bd}`,
      whiteSpace: "nowrap",
      ...style,
    }}>{children}</span>
  );
}

function CheckDot({ state }) {
  const map = {
    success: { color: "var(--success)", icon: I.check, title: "Checks passing" },
    failure: { color: "var(--danger)",  icon: I.x,     title: "Checks failing" },
    pending: { color: "var(--warn)",    icon: () => <span style={{ width:6, height:6, borderRadius:3, background:"currentColor", display:"block" }}/>, title: "Checks pending" },
    neutral: { color: "var(--text-faint)", icon: () => <span/>, title: "No checks" },
  };
  const { color, icon: Ic, title } = map[state] || map.neutral;
  return (
    <span title={title} style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:14, height:14, borderRadius:7, background: state === "pending" ? "transparent" : "transparent", color, animation: state === "pending" ? "beet-blink 1.2s ease-in-out infinite" : "none" }}>
      <Ic />
    </span>
  );
}

function DiffStat({ add, del }) {
  return (
    <span className="mono" style={{ display:"inline-flex", gap:4, fontSize: 11, color: "var(--text-faint)" }}>
      <span style={{ color: "var(--success)" }}>+{add}</span>
      <span style={{ color: "var(--danger)" }}>−{del}</span>
    </span>
  );
}

function Avatar({ login, size = 18, accent }) {
  // deterministic color from login
  const hues = [355, 25, 75, 145, 200, 240, 280, 320];
  let h = 0; for (let i=0;i<login.length;i++) h = (h*31 + login.charCodeAt(i)) >>> 0;
  const hue = hues[h % hues.length];
  const ch = login[0]?.toUpperCase() || "?";
  const ch2 = login[1]?.toUpperCase() || "";
  const bg = accent ? "var(--accent)" : `oklch(0.66 0.12 ${hue})`;
  const fg = "#fff";
  return (
    <span style={{
      display:"inline-flex", alignItems:"center", justifyContent:"center",
      width: size, height: size, borderRadius: size/2,
      background: bg, color: fg, fontSize: size*0.46, fontWeight: 600,
      letterSpacing: -0.3, flexShrink: 0,
    }}>{ch}{size > 22 ? ch2 : ""}</span>
  );
}

// Polling spinner — animated when 'spinning', otherwise static circular gauge.
function PollingDot({ spinning, last = "12s ago", paused }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:6, color: paused ? "var(--warn)" : "var(--text-muted)" }}>
      <span style={{ display:"inline-flex", width: 14, height: 14, alignItems:"center", justifyContent:"center", animation: spinning ? "beet-spin .9s linear infinite" : "none", color: paused ? "var(--warn)" : "var(--text-faint)" }}>
        {paused ? <span style={{ width:8, height:8, border:"2px solid currentColor", borderRadius:1 }}/> : I.refresh()}
      </span>
      <span style={{ fontSize: 11 }} className="mono">{paused ? "paused" : last}</span>
    </span>
  );
}

// ─────────── score bar ───────────
// Width mapped 0..15 → 0..100%. Color steps: ≥10 accent, ≥5 muted, <5 faint.
function ScoreBar({ score, width = 28 }) {
  const pct = Math.max(0, Math.min(1, score / 15));
  const color = score >= 10 ? "var(--accent)" : score >= 5 ? "var(--text-muted)" : "var(--text-faint)";
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap: 6 }}>
      <span style={{ width, height: 4, borderRadius: 2, background: "var(--panel-2)", overflow:"hidden" }}>
        <span style={{ display:"block", height:"100%", width: `${pct*100}%`, background: color, transition: "width .2s" }}/>
      </span>
      <span className="mono" style={{ fontSize: 10, color: "var(--text-faint)", minWidth: 12, textAlign:"right" }}>{score}</span>
    </span>
  );
}

// ─────────── reason badge (Needs Action Now) ───────────
function ReasonBadge({ reason }) {
  if (reason === "ejected") return <Pill tone="danger">Kicked from queue</Pill>;
  if (reason === "checks_failing") return <Pill tone="danger">Checks failing</Pill>;
  if (reason === "mention") return <Pill tone="info">@mention</Pill>;
  return null;
}

// ─────────── lifecycle pill ───────────
function Lifecycle({ state, mqPos }) {
  if (state === "merge_queue") return <Pill tone="accent" mono>queue · {mqPos ?? "?"}</Pill>;
  if (state === "in_review")   return <Pill tone="info">in review</Pill>;
  if (state === "open")        return <Pill tone="neutral">open</Pill>;
  if (state === "merged")      return <Pill tone="accent">merged</Pill>;
  return <Pill tone="neutral">{state}</Pill>;
}

// ─────────── run status ───────────
function RunStatus({ status, conclusion }) {
  if (status === "in_progress") return <Pill tone="info">running</Pill>;
  if (status === "queued" || status === "waiting" || status === "pending") return <Pill tone="warn">{status}</Pill>;
  if (conclusion === "success") return <Pill tone="success">success</Pill>;
  if (conclusion === "failure") return <Pill tone="danger">failed</Pill>;
  if (conclusion === "cancelled") return <Pill tone="neutral">cancelled</Pill>;
  return <Pill tone="neutral">{conclusion || status}</Pill>;
}

Object.assign(window, { I, BeetMark, Pill, CheckDot, DiffStat, Avatar, PollingDot, ScoreBar, ReasonBadge, Lifecycle, RunStatus });
