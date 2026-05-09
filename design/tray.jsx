/* Beet — Tray popover.
   Two visual variants gated by `variant`:
     "v1": restrained — single column, score badges only, very menu-bar-y
     "v2": with personality — a status strip up top, score bars on rows,
           subtle backgrounds for "Needs Action Now"
   Width 360, height 480 — per spec. Rounded corners + macOS vibrancy feel.
*/

function TrayPopover({ variant = "v1", onOpenWindow, onNotify, paused, onTogglePause, refreshing, onRefresh, accent }) {
  const [collapsed, setCollapsed] = React.useState({ recent: true });
  const [hovered, setHovered] = React.useState(null);
  const t = variant;

  const totalUnread =
    MOCK.needs.filter(x=>x.unread).length +
    MOCK.reviews.filter(x=>x.unread).length;

  const isV2 = t === "v2";

  return (
    <div style={{
      width: 360, height: 480,
      background: "var(--bg)",
      borderRadius: 12,
      boxShadow: "var(--shadow-lg), 0 0 0 0.5px var(--border-strong)",
      overflow: "hidden",
      display: "flex", flexDirection: "column",
      fontSize: 12.5,
    }}>
      {/* Title bar */}
      <div style={{
        display:"flex", alignItems:"center", gap: 8,
        padding: "10px 12px",
        borderBottom: "1px solid var(--border)",
        background: isV2 ? "linear-gradient(180deg, var(--panel) 0%, var(--bg) 100%)" : "var(--bg-elev)",
      }}>
        <BeetMark size={18} status={paused ? "paused" : (totalUnread > 0 ? "alert" : "ok")} />
        <span style={{ fontWeight: 600, letterSpacing: -0.2, fontSize: 13 }}>Beet</span>
        {totalUnread > 0 && (
          <span className="mono" style={{
            background: "var(--accent)", color: "var(--accent-fg)",
            fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 999, lineHeight: 1.5,
          }}>{totalUnread}</span>
        )}
        <span style={{ flex: 1 }}/>
        <PollingDot spinning={refreshing} paused={paused}/>
        <button onClick={onRefresh} title="Refresh now" style={iconBtn}>{I.refresh()}</button>
        <button onClick={onOpenWindow} title="Open main window" style={iconBtn}>{I.expand()}</button>
        <button onClick={onTogglePause} title={paused ? "Resume polling" : "Pause polling"} style={iconBtn}>
          {paused ? I.play() : <span style={{ display:"inline-flex", gap:1 }}><span style={{width:2,height:8,background:"currentColor"}}/><span style={{width:2,height:8,background:"currentColor"}}/></span>}
        </button>
      </div>

      {/* Scroll body */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        <Section
          variant={t} icon="🔴" title="Needs Action" count={MOCK.needs.length}
          collapsed={collapsed.needs} onToggle={() => setCollapsed(c => ({...c, needs: !c.needs}))}
          tint={isV2 ? "danger" : null}
        >
          {MOCK.needs.map((it) => (
            <NeedsRow key={it.id} item={it} variant={t} hovered={hovered===it.id} onHover={() => setHovered(it.id)} onLeave={() => setHovered(null)} />
          ))}
        </Section>

        <Section
          variant={t} icon="👀" title="Review Requests" count={MOCK.reviews.length}
          collapsed={collapsed.reviews} onToggle={() => setCollapsed(c => ({...c, reviews: !c.reviews}))}
        >
          {MOCK.reviews.slice(0,4).map((it) => (
            <ReviewRow key={it.id} item={it} variant={t} hovered={hovered===it.id} onHover={() => setHovered(it.id)} onLeave={() => setHovered(null)} />
          ))}
        </Section>

        <Section
          variant={t} icon="🚀" title="In Flight" count={MOCK.inflight.length}
          collapsed={collapsed.inflight} onToggle={() => setCollapsed(c => ({...c, inflight: !c.inflight}))}
        >
          {MOCK.inflight.map((it) => (
            <InflightRow key={it.id} item={it} variant={t} hovered={hovered===it.id} onHover={() => setHovered(it.id)} onLeave={() => setHovered(null)}/>
          ))}
        </Section>

        <Section
          variant={t} icon="⚙️" title="Standalone Runs" count={MOCK.runs.length}
          collapsed={collapsed.runs} onToggle={() => setCollapsed(c => ({...c, runs: !c.runs}))}
        >
          {MOCK.runs.map((r) => (
            <RunRow key={r.id} run={r} variant={t} />
          ))}
        </Section>

        <Section
          variant={t} icon="✅" title="Recently Resolved" count={MOCK.recent.length}
          collapsed={collapsed.recent} onToggle={() => setCollapsed(c => ({...c, recent: !c.recent}))}
          muted
        >
          {MOCK.recent.map((r) => (
            <RecentRow key={r.id} item={r} variant={t} />
          ))}
        </Section>
      </div>

      {/* Footer */}
      <div style={{
        borderTop: "1px solid var(--border)",
        padding: "8px 12px",
        display: "flex", alignItems: "center", gap: 8,
        background: "var(--bg-elev)",
        fontSize: 11.5,
      }}>
        <button onClick={onOpenWindow} style={{ ...footBtn }}>
          Open Beet {I.ext({ style:{ marginLeft: 4 } })}
        </button>
        <span style={{ flex: 1 }}/>
        <button onClick={onNotify} style={footBtn} title="Demo: fire a notification">Demo notify</button>
        <button style={footBtn}>{I.settings()}</button>
      </div>
    </div>
  );
}

const iconBtn = {
  display:"inline-flex", alignItems:"center", justifyContent:"center",
  width: 22, height: 22, borderRadius: 5,
  color: "var(--text-muted)",
  transition: "background .12s, color .12s",
};
const footBtn = {
  display:"inline-flex", alignItems:"center", gap: 4,
  padding: "3px 7px", borderRadius: 5,
  color: "var(--text-muted)",
  fontSize: 11.5, fontWeight: 500,
  transition: "background .12s, color .12s",
};

// Hover styles via inline pseudo would need CSS; emulate with onMouseEnter/Leave.
// For brevity here we leave defaults — the design canvas + tweak panel preview is what matters.

// ─────────── Section ───────────
function Section({ icon, title, count, collapsed, onToggle, children, variant, tint, muted }) {
  const isV2 = variant === "v2";
  const bg = tint === "danger" && isV2 ? "linear-gradient(180deg, var(--danger-soft), transparent)" : "transparent";
  return (
    <div style={{ background: bg }}>
      <button onClick={onToggle} style={{
        width: "100%",
        display: "flex", alignItems: "center", gap: 8,
        padding: "9px 12px 6px",
        color: muted ? "var(--text-faint)" : "var(--text-muted)",
        fontSize: 11, fontWeight: 600,
        textTransform: "uppercase", letterSpacing: 0.04,
        textAlign:"left",
      }}>
        <span style={{ fontSize: 12, filter: muted ? "grayscale(0.4) opacity(0.7)" : "none" }}>{icon}</span>
        <span>{title}</span>
        <span className="mono" style={{
          fontSize: 10.5, fontWeight: 500, padding: "0 5px", borderRadius: 999,
          background: "var(--panel-2)", color: "var(--text-faint)", letterSpacing: 0,
        }}>{count}</span>
        <span style={{ flex: 1 }}/>
        <span style={{
          display:"inline-flex", color:"var(--text-faint)",
          transition: "transform .15s",
          transform: collapsed ? "rotate(-90deg)" : "rotate(0)",
        }}>{I.chev()}</span>
      </button>
      {!collapsed && <div>{children}</div>}
    </div>
  );
}

// ─────────── Rows ───────────
const rowBase = {
  display: "grid",
  gridTemplateColumns: "auto 1fr auto",
  gap: 10,
  padding: "var(--row-pad-y) 12px",
  alignItems: "center",
  borderTop: "1px solid var(--border)",
  cursor: "pointer",
  position: "relative",
};

function NeedsRow({ item, variant, hovered, onHover, onLeave }) {
  return (
    <div style={{ ...rowBase, background: hovered ? "var(--hover)" : "transparent" }}
      onMouseEnter={onHover} onMouseLeave={onLeave}>
      <UnreadDot unread={item.unread}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display:"flex", alignItems:"center", gap: 6, marginBottom: 2 }}>
          <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>{item.repo}</span>
          <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>#{item.num}</span>
          <ReasonBadge reason={item.reason}/>
        </div>
        <div style={{
          fontWeight: 500, color: "var(--text)",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        }}>{item.title}</div>
        {variant === "v2" && (
          <div style={{ display:"flex", alignItems:"center", gap: 8, marginTop: 4, color: "var(--text-faint)", fontSize: 11 }}>
            <Avatar login={item.author} size={14}/>
            <span>{item.author}</span>
            <span>·</span>
            <span>{item.age}</span>
            {item.failing && <><span>·</span><span className="mono" style={{ color:"var(--danger)" }}>{item.failing.join(", ")}</span></>}
          </div>
        )}
      </div>
      <RowActions visible={hovered}/>
    </div>
  );
}

function ReviewRow({ item, variant, hovered, onHover, onLeave }) {
  return (
    <div style={{ ...rowBase, background: hovered ? "var(--hover)" : "transparent" }}
      onMouseEnter={onHover} onMouseLeave={onLeave}>
      <Avatar login={item.author} size={20}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display:"flex", alignItems:"center", gap: 6, marginBottom: 2 }}>
          <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>{item.repo}</span>
          <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>#{item.num}</span>
          {item.team && <Pill tone="accent" soft>team</Pill>}
          {item.draft && <Pill tone="neutral" soft>draft</Pill>}
        </div>
        <div style={{
          fontWeight: item.unread ? 600 : 500,
          color: item.unread ? "var(--text)" : "var(--text-muted)",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        }}>{item.title}</div>
        {variant === "v2" && (
          <div style={{ display:"flex", alignItems:"center", gap: 8, marginTop: 4 }}>
            <ScoreBar score={item.score} width={36}/>
            <span style={{ color:"var(--text-faint)", fontSize: 11 }}>by @{item.author}</span>
            <span style={{ color:"var(--text-faint)", fontSize: 11 }}>· {item.age}</span>
          </div>
        )}
      </div>
      <div style={{ display:"flex", alignItems:"center", gap: 6 }}>
        {variant === "v1" && <ScoreBar score={item.score} width={22}/>}
        <CheckDot state={item.checks.state}/>
      </div>
    </div>
  );
}

function InflightRow({ item, variant, hovered, onHover, onLeave }) {
  return (
    <div style={{ ...rowBase, background: hovered ? "var(--hover)" : "transparent" }}
      onMouseEnter={onHover} onMouseLeave={onLeave}>
      <UnreadDot unread={false}/>
      <div style={{ minWidth: 0 }}>
        <div style={{ display:"flex", alignItems:"center", gap: 6, marginBottom: 2 }}>
          <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>{item.repo}</span>
          <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>#{item.num}</span>
          <Lifecycle state={item.state} mqPos={item.mqPos}/>
        </div>
        <div style={{
          color: "var(--text)",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        }}>{item.title}</div>
      </div>
      <div style={{ display:"flex", alignItems:"center", gap: 6 }}>
        <DiffStat add={item.additions} del={item.deletions}/>
        <CheckDot state={item.checks.state}/>
      </div>
    </div>
  );
}

function RunRow({ run, variant }) {
  return (
    <div style={{ ...rowBase, gridTemplateColumns: "auto 1fr auto" }}>
      <span style={{ color: run.conclusion === "failure" ? "var(--danger)" : run.status === "in_progress" ? "var(--info)" : "var(--text-faint)" }}>
        {run.status === "in_progress" ? <span style={{ display:"inline-block", animation: "beet-spin 1s linear infinite" }}>{I.refresh()}</span> : I.play()}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display:"flex", alignItems:"center", gap: 6, marginBottom: 2 }}>
          <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>{run.repo}</span>
          <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>#{run.runNum}</span>
        </div>
        <div style={{ color: "var(--text)" }} className="mono">{run.name}</div>
      </div>
      <RunStatus status={run.status} conclusion={run.conclusion}/>
    </div>
  );
}

function RecentRow({ item }) {
  return (
    <div style={{ ...rowBase, opacity: 0.7 }}>
      <span style={{ color: "var(--success)" }}>{I.check()}</span>
      <div style={{ minWidth: 0 }}>
        <div style={{ display:"flex", alignItems:"center", gap: 6, marginBottom: 1 }}>
          <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>{item.repo}</span>
          {item.num && <span className="mono" style={{ color: "var(--text-faint)", fontSize: 11 }}>#{item.num}</span>}
        </div>
        <div style={{
          color: "var(--text-muted)",
          overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap",
        }}>{item.title || item.name}</div>
      </div>
      <span style={{ fontSize: 11, color: "var(--text-faint)" }} className="mono">{item.age}</span>
    </div>
  );
}

function UnreadDot({ unread }) {
  return (
    <span style={{
      display: "inline-block", width: 6, height: 6, borderRadius: 3,
      background: unread ? "var(--accent)" : "transparent",
      flexShrink: 0,
    }}/>
  );
}

function RowActions({ visible }) {
  if (!visible) return <span style={{ width: 0 }}/>;
  return (
    <div style={{ display:"inline-flex", gap: 2 }}>
      <button style={iconBtn} title="Mark read">{I.check()}</button>
      <button style={iconBtn} title="Snooze">{I.zzz()}</button>
      <button style={iconBtn} title="Mute repo">{I.mute()}</button>
    </div>
  );
}

window.TrayPopover = TrayPopover;
